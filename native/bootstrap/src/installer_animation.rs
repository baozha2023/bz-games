use anyhow::{Context, Result};
use std::time::{Duration, Instant};
use tiny_skia::{Color, FilterQuality, Pixmap, PixmapPaint, Rect, Transform};

const BASE_ICON_SIZE: f32 = 360.0;
const SOURCE_IMAGE_SIZE: u32 = 1024;
const SOURCE_IMAGE_SIZE_F32: f32 = 1024.0;
const FRAGMENT_SPREAD: f32 = 100.0;
const INITIAL_LOGO_HOLD_MS: u64 = 350;
const SEPARATION_DURATION_MS: u64 = 275;
const ROTATION_START_MS: u64 = INITIAL_LOGO_HOLD_MS + SEPARATION_DURATION_MS;
const TURN_DURATION_MS: u64 = 1_000;
const BETWEEN_TURNS_PAUSE_MS: u64 = 50;
const SECOND_TURN_START_MS: u64 = TURN_DURATION_MS + BETWEEN_TURNS_PAUSE_MS;
const ROTATION_END_MS: u64 = ROTATION_START_MS + SECOND_TURN_START_MS + TURN_DURATION_MS;
const RETURN_DURATION_MS: u64 = 625;
const ACTION_END_MS: u64 = ROTATION_END_MS + RETURN_DURATION_MS;
const REPLAY_PAUSE_MS: u64 = 1_000;
const REPLAY_ACTION_DURATION_MS: u64 = ACTION_END_MS - INITIAL_LOGO_HOLD_MS;
const REPLAY_CYCLE_MS: u64 = REPLAY_PAUSE_MS + REPLAY_ACTION_DURATION_MS;
pub const ACTION_DURATION: Duration = Duration::from_millis(ACTION_END_MS);

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
        if complete.width() != SOURCE_IMAGE_SIZE || complete.height() != SOURCE_IMAGE_SIZE {
            anyhow::bail!(
                "complete installer logo must be 1024x1024, got {}x{}",
                complete.width(),
                complete.height()
            );
        }
        if pieces
            .iter()
            .any(|piece| piece.width() != SOURCE_IMAGE_SIZE || piece.height() != SOURCE_IMAGE_SIZE)
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

    pub const fn set_phase(&mut self, phase: InstallPhase) {
        self.phase = phase;
    }

    pub const fn restart(&mut self, now: Instant) {
        self.started_at = now;
    }

    pub fn elapsed(&self, now: Instant) -> Duration {
        now.saturating_duration_since(self.started_at)
    }

    pub fn completion_deadline(&self, now: Instant) -> Instant {
        let elapsed_ms = elapsed_millis(self.elapsed(now));
        if elapsed_ms < ACTION_END_MS {
            return self.started_at + ACTION_DURATION;
        }
        let replay_position = (elapsed_ms - ACTION_END_MS) % REPLAY_CYCLE_MS;
        if replay_position < REPLAY_PAUSE_MS {
            now
        } else {
            now + Duration::from_millis(REPLAY_CYCLE_MS - replay_position)
        }
    }

    pub fn render(&self, width: u32, height: u32, dpi_scale: f32, now: Instant) -> Result<Pixmap> {
        let mut canvas = Pixmap::new(width.max(1), height.max(1))
            .context("create installer animation canvas")?;

        let width = width as f32;
        let height = height as f32;
        let center_x = width / 2.0;
        let center_y = height / 2.0 - 4.0;
        let dpi_scale = dpi_scale.clamp(1.0, 4.0);
        // The complete motion envelope is the logo half-size plus the per-axis
        // fragment spread. Cap the DPI scale against the actual
        // window so all four scaled fragments remain visible.
        let motion_envelope = 2.0 * (BASE_ICON_SIZE / 2.0 + FRAGMENT_SPREAD);
        let available_scale = width.min(height) * 0.90 / motion_envelope;
        let display_scale = dpi_scale
            .min(available_scale)
            .clamp(1.0 / BASE_ICON_SIZE, SOURCE_IMAGE_SIZE_F32 / BASE_ICON_SIZE);
        let icon_size = BASE_ICON_SIZE * display_scale;
        let scale = icon_size / SOURCE_IMAGE_SIZE_F32;
        let elapsed_ms = elapsed_millis(self.elapsed(now));
        let motion = motion_at(animation_time_at(elapsed_ms));

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
                    offset_x * display_scale,
                    offset_y * display_scale,
                    motion.angle,
                    tilts[index] * motion.tilt_factor,
                );
                canvas.draw_pixmap(0, 0, piece.as_ref(), &paint, transform, None);
            }
        }

        draw_progress_bar(
            &mut canvas,
            width,
            height,
            display_scale,
            progress_percent(self.phase),
        );
        Ok(canvas)
    }
}

fn elapsed_millis(elapsed: Duration) -> u64 {
    u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
}

const fn animation_time_at(elapsed_ms: u64) -> u64 {
    if elapsed_ms < ACTION_END_MS {
        return elapsed_ms;
    }
    let replay_position = (elapsed_ms - ACTION_END_MS) % REPLAY_CYCLE_MS;
    if replay_position < REPLAY_PAUSE_MS {
        ACTION_END_MS
    } else {
        INITIAL_LOGO_HOLD_MS + replay_position - REPLAY_PAUSE_MS
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
        .pre_translate(-SOURCE_IMAGE_SIZE_F32 / 2.0, -SOURCE_IMAGE_SIZE_F32 / 2.0)
}

fn motion_at(action_ms: u64) -> Motion {
    // Each fragment moves 100 logical pixels away from the logo center on
    // both axes. Rendering multiplies this value by the effective DPI scale.
    if action_ms < INITIAL_LOGO_HOLD_MS {
        return Motion {
            full_opacity: 1.0,
            piece_opacity: 0.0,
            spread: 0.0,
            angle: 0.0,
            tilt_factor: 0.0,
        };
    }
    if action_ms < ROTATION_START_MS {
        let t = ease_out((action_ms - INITIAL_LOGO_HOLD_MS) as f32 / SEPARATION_DURATION_MS as f32);
        return Motion {
            full_opacity: 1.0 - t,
            piece_opacity: t,
            spread: FRAGMENT_SPREAD * t,
            angle: 0.0,
            tilt_factor: t,
        };
    }
    if action_ms < ROTATION_END_MS {
        return Motion {
            full_opacity: 0.0,
            piece_opacity: 1.0,
            spread: FRAGMENT_SPREAD,
            angle: two_turn_angle(action_ms - ROTATION_START_MS),
            tilt_factor: 1.0,
        };
    }
    if action_ms < ACTION_END_MS {
        let t = ease_in_out((action_ms - ROTATION_END_MS) as f32 / RETURN_DURATION_MS as f32);
        return Motion {
            // Keep the complete logo hidden until the fragments have fully
            // returned. At the action boundary the static-logo branch
            // replaces the fragments in one frame, so there is no overlap or
            // premature center logo during the return motion.
            full_opacity: 0.0,
            piece_opacity: 1.0,
            spread: FRAGMENT_SPREAD * (1.0 - t),
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

fn two_turn_angle(rotation_ms: u64) -> f32 {
    if rotation_ms <= TURN_DURATION_MS {
        return 360.0 * ease_in_out(rotation_ms as f32 / TURN_DURATION_MS as f32);
    }
    if rotation_ms < SECOND_TURN_START_MS {
        return 360.0;
    }
    let second_turn_ms = (rotation_ms - SECOND_TURN_START_MS).min(TURN_DURATION_MS);
    360.0 + 360.0 * ease_in_out(second_turn_ms as f32 / TURN_DURATION_MS as f32)
}

pub const fn progress_percent(phase: InstallPhase) -> u8 {
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

fn draw_progress_bar(
    canvas: &mut Pixmap,
    width: f32,
    height: f32,
    display_scale: f32,
    percent: u8,
) {
    let bar_width = (width * 0.62).min(720.0 * display_scale);
    let bar_height = 6.0 * display_scale;
    let left = (width - bar_width) / 2.0;
    let top = (height - 72.0 * display_scale).max(0.0);

    let Some(track) = Rect::from_xywh(left, top, bar_width, bar_height) else {
        return;
    };
    let mut paint = tiny_skia::Paint::default();
    paint.set_color(Color::from_rgba8(25, 43, 70, 230));
    canvas.fill_rect(track, &paint, Transform::identity(), None);

    let progress_width = bar_width * (f32::from(percent.min(100)) / 100.0);
    if progress_width <= 0.0 {
        return;
    }
    let Some(progress) = Rect::from_xywh(left, top, progress_width, bar_height) else {
        return;
    };
    paint.set_color(if percent == 100 {
        Color::from_rgba8(70, 214, 147, 255)
    } else {
        Color::from_rgba8(102, 166, 255, 255)
    });
    canvas.fill_rect(progress, &paint, Transform::identity(), None);
}

#[cfg(test)]
mod tests {
    use super::{
        animation_time_at, motion_at, piece_transform, two_turn_angle, AnimationRenderer,
        ACTION_DURATION, ACTION_END_MS, BETWEEN_TURNS_PAUSE_MS, FRAGMENT_SPREAD,
        INITIAL_LOGO_HOLD_MS, REPLAY_ACTION_DURATION_MS, REPLAY_CYCLE_MS, REPLAY_PAUSE_MS,
        ROTATION_END_MS, ROTATION_START_MS, SOURCE_IMAGE_SIZE_F32, TURN_DURATION_MS,
    };
    use std::time::{Duration, Instant};
    use tiny_skia::Point;

    const COMPLETE: &[u8] = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../resources/icon.png"
    ));
    const Q1: &[u8] = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../resources/installer-logo-q1.png"
    ));
    const Q2: &[u8] = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../resources/installer-logo-q2.png"
    ));
    const Q3: &[u8] = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../resources/installer-logo-q3.png"
    ));
    const Q4: &[u8] = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../resources/installer-logo-q4.png"
    ));

    #[test]
    fn animation_has_exact_two_clockwise_turns() {
        assert_eq!(BETWEEN_TURNS_PAUSE_MS, 50);
        assert_eq!(motion_at(ROTATION_START_MS).angle, 0.0);
        assert_eq!(motion_at(ROTATION_START_MS).spread, FRAGMENT_SPREAD);
        assert_eq!(FRAGMENT_SPREAD, 100.0);
        assert_eq!(two_turn_angle(TURN_DURATION_MS), 360.0);
        assert_eq!(
            two_turn_angle(TURN_DURATION_MS + BETWEEN_TURNS_PAUSE_MS - 1),
            360.0
        );
        assert!(two_turn_angle(TURN_DURATION_MS + BETWEEN_TURNS_PAUSE_MS + 50) > 360.0);
        assert_eq!(motion_at(ROTATION_END_MS).angle, 720.0);
    }

    #[test]
    fn animation_background_uses_alpha_transparency() {
        let renderer = AnimationRenderer::new(COMPLETE, [Q1, Q2, Q3, Q4]).unwrap();
        let frame = renderer.render(1080, 1080, 1.0, Instant::now()).unwrap();
        assert_eq!(frame.pixel(0, 0).unwrap().alpha(), 0);
        assert!(frame.pixel(540, 540).unwrap().alpha() > 0);
    }

    #[test]
    fn dpi_scales_from_the_original_without_exceeding_source_resolution() {
        let renderer = AnimationRenderer::new(COMPLETE, [Q1, Q2, Q3, Q4]).unwrap();
        let normal = renderer.render(1080, 1080, 1.0, Instant::now()).unwrap();
        let high_dpi = renderer.render(1080, 1080, 2.0, Instant::now()).unwrap();
        let opaque_width = |frame: &tiny_skia::Pixmap| {
            (0..frame.width())
                .filter(|x| frame.pixel(*x, 540).is_some_and(|pixel| pixel.alpha() > 0))
                .count()
        };
        assert!(opaque_width(&high_dpi) > opaque_width(&normal));
    }

    #[test]
    fn fragment_images_and_spread_scale_together_with_dpi() {
        let renderer = AnimationRenderer::new(COMPLETE, [Q1, Q2, Q3, Q4]).unwrap();
        let now = renderer.started_at + Duration::from_millis(1_000);
        let normal = renderer.render(1080, 1080, 1.0, now).unwrap();
        let high_dpi = renderer.render(2160, 2160, 2.0, now).unwrap();
        let opaque_bounds = |frame: &tiny_skia::Pixmap, max_y: u32| {
            let mut left = frame.width();
            let mut right = 0;
            for y in 0..max_y {
                for x in 0..frame.width() {
                    if frame.pixel(x, y).is_some_and(|pixel| pixel.alpha() > 0) {
                        left = left.min(x);
                        right = right.max(x);
                    }
                }
            }
            right.saturating_sub(left) + 1
        };
        let normal_width = opaque_bounds(&normal, 950);
        let high_dpi_width = opaque_bounds(&high_dpi, 1900);
        assert!(high_dpi_width >= normal_width * 19 / 10);
        assert!(high_dpi_width <= normal_width * 21 / 10);
    }

    #[test]
    fn completion_waits_for_the_first_or_current_action_only() {
        let renderer = AnimationRenderer::new(COMPLETE, [Q1, Q2, Q3, Q4]).unwrap();
        assert_eq!(
            renderer.completion_deadline(renderer.started_at + Duration::from_secs(1)),
            renderer.started_at + ACTION_DURATION
        );
        let first_pause = renderer.started_at + ACTION_DURATION + Duration::from_millis(500);
        assert_eq!(renderer.completion_deadline(first_pause), first_pause);
        let second_action =
            renderer.started_at + ACTION_DURATION + Duration::from_millis(REPLAY_PAUSE_MS + 500);
        assert_eq!(
            renderer.completion_deadline(second_action),
            renderer.started_at + ACTION_DURATION + Duration::from_millis(REPLAY_CYCLE_MS)
        );
    }

    #[test]
    fn animation_returns_to_the_complete_logo_after_the_action() {
        let motion = motion_at(ACTION_DURATION.as_millis() as u64);
        assert_eq!(motion.full_opacity, 1.0);
        assert_eq!(motion.piece_opacity, 0.0);
        assert_eq!(motion.spread, 0.0);
    }

    #[test]
    fn animation_replays_after_a_one_second_complete_logo_pause() {
        assert_eq!(animation_time_at(ACTION_END_MS), ACTION_END_MS);
        assert_eq!(
            animation_time_at(ACTION_END_MS + REPLAY_PAUSE_MS - 1),
            ACTION_END_MS
        );
        assert_eq!(
            animation_time_at(ACTION_END_MS + REPLAY_PAUSE_MS),
            INITIAL_LOGO_HOLD_MS
        );
        assert_eq!(
            animation_time_at(ACTION_END_MS + REPLAY_CYCLE_MS - 1),
            ACTION_END_MS - 1
        );
        assert_eq!(
            animation_time_at(ACTION_END_MS + REPLAY_CYCLE_MS),
            ACTION_END_MS
        );
    }

    #[test]
    fn complete_logo_waits_until_fragments_finish_returning() {
        let just_before_swap = motion_at(ACTION_END_MS - 1);
        assert_eq!(just_before_swap.full_opacity, 0.0);
        assert_eq!(just_before_swap.piece_opacity, 1.0);
        assert!(just_before_swap.spread < 0.01);

        let after_swap = motion_at(ACTION_END_MS);
        assert_eq!(after_swap.full_opacity, 1.0);
        assert_eq!(after_swap.piece_opacity, 0.0);
        assert_eq!(after_swap.spread, 0.0);
    }

    #[test]
    fn pieces_orbit_the_shared_logo_center() {
        let center = (300.0, 300.0);
        let source_center = SOURCE_IMAGE_SIZE_F32 / 2.0;
        let mut upper_left = Point::from_xy(source_center, source_center);
        let mut upper_right = Point::from_xy(source_center, source_center);
        piece_transform(
            center.0,
            center.1,
            1.0,
            -FRAGMENT_SPREAD,
            -FRAGMENT_SPREAD,
            90.0,
            0.0,
        )
        .map_point(&mut upper_left);
        piece_transform(
            center.0,
            center.1,
            1.0,
            FRAGMENT_SPREAD,
            -FRAGMENT_SPREAD,
            90.0,
            0.0,
        )
        .map_point(&mut upper_right);

        assert!((upper_left.x - 400.0).abs() < 0.01);
        assert!((upper_left.y - 200.0).abs() < 0.01);
        assert!((upper_right.x - 400.0).abs() < 0.01);
        assert!((upper_right.y - 400.0).abs() < 0.01);
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
    fn timing_is_derived_from_actions_and_the_replay_pause() {
        assert_eq!(ACTION_DURATION.as_millis(), 3_300);
        assert_eq!(REPLAY_ACTION_DURATION_MS, 2_950);
        assert_eq!(REPLAY_PAUSE_MS, 1_000);
        assert_eq!(REPLAY_CYCLE_MS, 3_950);
    }
}
