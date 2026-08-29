use anyhow::{Context, Result};
use std::time::{Duration, Instant};
use tiny_skia::{Color, FilterQuality, Pixmap, PixmapPaint, Rect, Transform};

#[allow(dead_code)]
pub const ACTION_DURATION: Duration = Duration::from_millis(3_000);
#[allow(dead_code)]
pub const STATIC_DURATION: Duration = Duration::from_millis(1_000);
pub const CYCLE_DURATION: Duration = ACTION_DURATION.saturating_add(STATIC_DURATION);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallPhase {
    Preparing,
    Installing,
    Finalizing,
    Completed,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Motion {
    full_opacity: f32,
    piece_opacity: f32,
    spread: f32,
    angle: f32,
    tilt_factor: f32,
}

pub struct AnimationRenderer {
    complete: Pixmap,
    pieces: [Pixmap; 4],
    started_at: Instant,
    phase: InstallPhase,
}

impl AnimationRenderer {
    pub fn new(complete: &[u8], pieces: [&[u8]; 4]) -> Result<Self> {
        let complete = Pixmap::decode_png(complete).context("decode complete installer logo")?;
        let pieces = [
            Pixmap::decode_png(pieces[0]).context("decode installer logo quadrant 1")?,
            Pixmap::decode_png(pieces[1]).context("decode installer logo quadrant 2")?,
            Pixmap::decode_png(pieces[2]).context("decode installer logo quadrant 3")?,
            Pixmap::decode_png(pieces[3]).context("decode installer logo quadrant 4")?,
        ];
        if complete.width() != 1024 || complete.height() != 1024 {
            anyhow::bail!(
                "complete installer logo must be 1024x1024, got {}x{}",
                complete.width(),
                complete.height()
            );
        }
        if pieces
            .iter()
            .any(|piece| piece.width() != 1024 || piece.height() != 1024)
        {
            anyhow::bail!("installer logo quadrants must all be 1024x1024");
        }
        Ok(Self {
            complete,
            pieces,
            started_at: Instant::now(),
            phase: InstallPhase::Preparing,
        })
    }

    pub fn set_phase(&mut self, phase: InstallPhase) {
        self.phase = phase;
    }

    pub fn restart_cycle(&mut self, now: Instant) {
        self.started_at = now;
    }

    pub fn elapsed(&self, now: Instant) -> Duration {
        now.saturating_duration_since(self.started_at)
    }

    pub fn next_cycle_deadline(&self, now: Instant) -> Instant {
        let elapsed = self.elapsed(now);
        let cycles = elapsed.as_millis() / CYCLE_DURATION.as_millis() + 1;
        self.started_at + CYCLE_DURATION.saturating_mul(cycles as u32)
    }

    pub fn render(&self, width: u32, height: u32, now: Instant) -> Result<Pixmap> {
        let mut canvas = Pixmap::new(width.max(1), height.max(1))
            .context("create installer animation canvas")?;
        // The installer window switches to a color-keyed layered window while
        // this canvas is visible. The key-colored fill therefore disappears,
        // leaving only the logo and bottom progress bar on screen.
        canvas.fill(Color::from_rgba8(3, 9, 24, 255));

        let width = width as f32;
        let height = height as f32;
        let center_x = width / 2.0;
        let center_y = height / 2.0 - 4.0;
        let icon_size = (width.min(height) * 0.70).clamp(220.0, 360.0);
        let scale = icon_size / 1024.0;
        let elapsed = self.elapsed(now).as_millis() as f32;
        let cycle_ms = (elapsed % CYCLE_DURATION.as_millis() as f32) as u64;
        let motion = motion_at(cycle_ms);

        if motion.full_opacity > 0.0 {
            let paint = PixmapPaint {
                opacity: motion.full_opacity,
                quality: FilterQuality::Bicubic,
                ..PixmapPaint::default()
            };
            canvas.draw_pixmap(
                0,
                0,
                self.complete.as_ref(),
                &paint,
                Transform::from_translate(center_x - icon_size / 2.0, center_y - icon_size / 2.0)
                    .pre_scale(scale, scale),
                None,
            );
        }

        if motion.piece_opacity > 0.0 {
            let offsets = [
                (-motion.spread, -motion.spread),
                (motion.spread, -motion.spread),
                (-motion.spread, motion.spread),
                (motion.spread, motion.spread),
            ];
            // Fixed per-piece values keep the result deterministic while
            // creating the requested irregular, blast-like silhouette.
            let tilts = [-12.0, 9.0, 14.0, -8.0];
            let paint = PixmapPaint {
                opacity: motion.piece_opacity,
                quality: FilterQuality::Bicubic,
                ..PixmapPaint::default()
            };
            for (index, (piece, (offset_x, offset_y))) in
                self.pieces.iter().zip(offsets).enumerate()
            {
                let transform = piece_transform(
                    center_x,
                    center_y,
                    scale,
                    offset_x,
                    offset_y,
                    motion.angle,
                    tilts[index] * motion.tilt_factor,
                );
                canvas.draw_pixmap(0, 0, piece.as_ref(), &paint, transform, None);
            }
        }

        draw_progress_bar(&mut canvas, width, height, progress_percent(self.phase));
        Ok(canvas)
    }
}

fn piece_transform(
    center_x: f32,
    center_y: f32,
    scale: f32,
    offset_x: f32,
    offset_y: f32,
    angle: f32,
    tilt: f32,
) -> Transform {
    // This is one shared group transform around the Logo center. The local
    // quadrant center is translated to the origin, scaled, moved outward,
    // then the whole group rotates around the common center before it is
    // placed on the canvas. It deliberately does not rotate each piece in
    // place around its own center.
    Transform::from_translate(center_x, center_y)
        .pre_rotate(angle)
        .pre_translate(offset_x, offset_y)
        .pre_rotate(tilt)
        .pre_scale(scale, scale)
        .pre_translate(-512.0, -512.0)
}

fn motion_at(cycle_ms: u64) -> Motion {
    const SPREAD: f32 = 192.0;
    if cycle_ms < 350 {
        return Motion {
            full_opacity: 1.0,
            piece_opacity: 0.0,
            spread: 0.0,
            angle: 0.0,
            tilt_factor: 0.0,
        };
    }
    if cycle_ms < 625 {
        let t = ease_out((cycle_ms - 350) as f32 / 275.0);
        return Motion {
            full_opacity: 1.0 - t,
            piece_opacity: t,
            spread: SPREAD * t,
            angle: 0.0,
            tilt_factor: t,
        };
    }
    if cycle_ms < 2_375 {
        let t = (cycle_ms - 625) as f32 / 1_750.0;
        return Motion {
            full_opacity: 0.0,
            piece_opacity: 1.0,
            spread: SPREAD,
            angle: 720.0 * t,
            tilt_factor: 1.0,
        };
    }
    if cycle_ms < 3_000 {
        let t = ease_in_out((cycle_ms - 2_375) as f32 / 625.0);
        return Motion {
            // Keep the complete logo hidden until the fragments have fully
            // returned. At the 3-second boundary the static-logo branch
            // replaces the fragments in one frame, so there is no overlap or
            // premature center logo during the return motion.
            full_opacity: 0.0,
            piece_opacity: 1.0,
            spread: SPREAD * (1.0 - t),
            angle: 720.0,
            tilt_factor: 1.0 - t,
        };
    }
    Motion {
        full_opacity: 1.0,
        piece_opacity: 0.0,
        spread: 0.0,
        angle: 0.0,
        tilt_factor: 0.0,
    }
}

pub fn progress_percent(phase: InstallPhase) -> u8 {
    match phase {
        InstallPhase::Preparing => 8,
        InstallPhase::Installing => 28,
        InstallPhase::Finalizing => 78,
        InstallPhase::Completed => 100,
    }
}

fn ease_out(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}

fn ease_in_out(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    if t < 0.5 {
        4.0 * t * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
    }
}

fn draw_progress_bar(canvas: &mut Pixmap, width: f32, height: f32, percent: u8) {
    let bar_width = (width * 0.62).clamp(420.0, 720.0);
    let bar_height = 6.0;
    let left = (width - bar_width) / 2.0;
    let top = (height - 72.0).max(0.0);

    let Some(track) = Rect::from_xywh(left, top, bar_width, bar_height) else {
        return;
    };
    let mut paint = tiny_skia::Paint::default();
    paint.set_color(Color::from_rgba8(25, 43, 70, 230));
    canvas.fill_rect(track, &paint, Transform::identity(), None);

    let progress_width = bar_width * (percent.min(100) as f32 / 100.0);
    if progress_width <= 0.0 {
        return;
    }
    let Some(progress) = Rect::from_xywh(left, top, progress_width, bar_height) else {
        return;
    };
    paint.set_color(match percent {
        100 => Color::from_rgba8(70, 214, 147, 255),
        0 => Color::from_rgba8(255, 102, 122, 255),
        _ => Color::from_rgba8(102, 166, 255, 255),
    });
    canvas.fill_rect(progress, &paint, Transform::identity(), None);
}

#[cfg(test)]
mod tests {
    use super::{motion_at, piece_transform, ACTION_DURATION, CYCLE_DURATION, STATIC_DURATION};
    use tiny_skia::Point;

    #[test]
    fn animation_has_exact_two_clockwise_turns() {
        assert_eq!(motion_at(625).angle, 0.0);
        assert_eq!(motion_at(2_375).angle, 720.0);
    }

    #[test]
    fn animation_returns_to_the_complete_logo_after_three_seconds() {
        let motion = motion_at(ACTION_DURATION.as_millis() as u64);
        assert_eq!(motion.full_opacity, 1.0);
        assert_eq!(motion.piece_opacity, 0.0);
        assert_eq!(motion.spread, 0.0);
    }

    #[test]
    fn complete_logo_waits_until_fragments_finish_returning() {
        let just_before_swap = motion_at(2_999);
        assert_eq!(just_before_swap.full_opacity, 0.0);
        assert_eq!(just_before_swap.piece_opacity, 1.0);
        assert!(just_before_swap.spread < 0.01);

        let after_swap = motion_at(3_000);
        assert_eq!(after_swap.full_opacity, 1.0);
        assert_eq!(after_swap.piece_opacity, 0.0);
        assert_eq!(after_swap.spread, 0.0);
    }

    #[test]
    fn pieces_orbit_the_shared_logo_center() {
        let center = (300.0, 300.0);
        let mut upper_left = Point::from_xy(512.0, 512.0);
        let mut upper_right = Point::from_xy(512.0, 512.0);
        piece_transform(center.0, center.1, 1.0, -192.0, -192.0, 90.0, 0.0)
            .map_point(&mut upper_left);
        piece_transform(center.0, center.1, 1.0, 192.0, -192.0, 90.0, 0.0)
            .map_point(&mut upper_right);

        assert!((upper_left.x - 492.0).abs() < 0.01);
        assert!((upper_left.y - 108.0).abs() < 0.01);
        assert!((upper_right.x - 492.0).abs() < 0.01);
        assert!((upper_right.y - 492.0).abs() < 0.01);
    }

    #[test]
    fn phase_progress_values_are_explicit_and_monotonic() {
        use super::{progress_percent, InstallPhase};

        assert_eq!(progress_percent(InstallPhase::Preparing), 8);
        assert_eq!(progress_percent(InstallPhase::Installing), 28);
        assert_eq!(progress_percent(InstallPhase::Finalizing), 78);
        assert_eq!(progress_percent(InstallPhase::Completed), 100);
    }

    #[test]
    fn static_hold_fills_the_rest_of_the_four_second_cycle() {
        assert_eq!(CYCLE_DURATION.as_millis(), 4_000);
        assert_eq!(ACTION_DURATION.as_millis(), 3_000);
        assert_eq!(STATIC_DURATION.as_millis(), 1_000);
    }
}
