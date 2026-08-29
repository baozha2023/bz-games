#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[path = "../installer_animation.rs"]
mod installer_animation;

use anyhow::{bail, Context, Result};
use installer_animation::{AnimationRenderer, InstallPhase};
use mslnk::ShellLink;
use native_windows_gui as nwg;
use rfd::{MessageDialog, MessageLevel};
use std::{
    cell::{Cell, RefCell},
    fs,
    os::windows::ffi::OsStrExt,
    os::windows::fs::MetadataExt,
    path::{Path, PathBuf},
    process::Command,
    rc::Rc,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;
use winapi::shared::windef::RECT;
use winapi::um::wingdi::{SetDIBitsToDevice, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS};
use winapi::um::winuser::{
    GetWindowLongW, GetWindowRect, SetLayeredWindowAttributes, SetWindowLongW, SetWindowPos,
    ShowWindow, GWL_EXSTYLE, GWL_STYLE, HWND_BOTTOM, HWND_TOP, LWA_COLORKEY, SWP_FRAMECHANGED,
    SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_SHOWWINDOW,
    SW_HIDE, WS_CAPTION, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP,
    WS_SYSMENU, WS_THICKFRAME, WS_VISIBLE,
};
use windows::{
    core::PCWSTR,
    Win32::{
        Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW},
        System::WindowsProgramming::DRIVE_REMOTE,
    },
};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const VELOPACK_SETUP: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/velopack-setup.exe"));
const ROOT_LAUNCHER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/BZ-Games.exe"));
const ROOT_UNINSTALLER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/BZ-Games-Uninstall.exe"));
const APP_ICON: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/icon.ico"
));
const APP_ICON_PNG: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/icon.png"
));
const APP_ICON_Q1: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/installer-logo-q1.png"
));
const APP_ICON_Q2: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/installer-logo-q2.png"
));
const APP_ICON_Q3: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/installer-logo-q3.png"
));
const APP_ICON_Q4: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../resources/installer-logo-q4.png"
));
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const NORMAL_WINDOW_SIZE: (i32, i32) = (760, 520);
// 192px per-axis blast displacement plus the 360px logo leaves a safe
// transparent margin around every rotated quadrant.
const ANIMATION_WINDOW_SIZE: (i32, i32) = (1080, 1080);

fn app_version() -> &'static str {
    option_env!("BZ_APP_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
}

fn format_size(bytes: u64) -> String {
    const GB: f64 = 1_000_000_000.0;
    const MB: f64 = 1_000_000.0;
    const KB: f64 = 1_000.0;
    let bytes = bytes as f64;
    if bytes >= GB {
        format!("{:.1} GB", bytes / GB)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes / MB)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes / KB)
    } else {
        format!("{} B", bytes as u64)
    }
}

fn required_install_size_text() -> String {
    option_env!("BZ_INSTALLED_SIZE_BYTES")
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .map(|value| format!("所需空间：约 {}", format_size(value)))
        .unwrap_or_else(|| "所需空间：安装后大小由当前版本决定".to_string())
}

fn existing_path(path: &Path) -> &Path {
    let mut current = path;
    while !current.exists() {
        match current.parent() {
            Some(parent) => current = parent,
            None => break,
        }
    }
    current
}

fn available_space_text(path: &Path) -> String {
    let path = existing_path(path);
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0u64;
    let result =
        unsafe { GetDiskFreeSpaceExW(PCWSTR(wide.as_ptr()), Some(&mut available), None, None) };
    match result {
        Ok(()) => format!("可用空间：{}", format_size(available)),
        Err(_) => "可用空间：无法获取".to_string(),
    }
}

fn raise_control(handle: &nwg::ControlHandle) {
    let Some(hwnd) = handle.hwnd() else {
        return;
    };
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOP,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        );
    }
}

fn default_root() -> Result<PathBuf> {
    Ok(dirs::data_local_dir()
        .context("LOCALAPPDATA is unavailable")?
        .join("Programs")
        .join("BZ-Games"))
}

fn installation_root(parent: &Path) -> PathBuf {
    let is_named_bz_games = parent
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("BZ-Games"));
    if is_named_bz_games {
        parent.to_path_buf()
    } else {
        parent.join("BZ-Games")
    }
}

fn path_is_forbidden(target: &Path) -> Result<bool> {
    let target = target.to_path_buf();
    let normalized = target.to_string_lossy().replace('/', "\\").to_lowercase();
    if target.parent().is_none()
        || normalized == r"c:\windows"
        || normalized.starts_with(r"c:\windows\")
        || normalized == r"c:\program files"
        || normalized.starts_with(r"c:\program files\")
        || normalized == r"c:\program files (x86)"
        || normalized.starts_with(r"c:\program files (x86)\")
    {
        return Ok(true);
    }
    if target.to_string_lossy().starts_with(r"\\") {
        return Ok(true);
    }
    if let Some(volume_root) = target.ancestors().last() {
        let wide: Vec<u16> = volume_root
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        if unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) } == DRIVE_REMOTE {
            return Ok(true);
        }
    }
    if let Some(home) = dirs::home_dir() {
        if normalized == home.to_string_lossy().replace('/', "\\").to_lowercase() {
            return Ok(true);
        }
    }
    let mut cursor = target.as_path();
    loop {
        if cursor.exists() {
            let metadata = fs::symlink_metadata(cursor)?;
            if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                return Ok(true);
            }
        }
        let Some(parent) = cursor.parent() else { break };
        cursor = parent;
    }
    Ok(false)
}

fn validate_target(target: &Path) -> Result<()> {
    if path_is_forbidden(target)? {
        bail!("This installation path is not supported");
    }
    if target.exists() && fs::read_dir(target)?.next().is_some() {
        bail!("The selected directory is already occupied. Choose a new empty directory");
    }
    fs::create_dir_all(target)?;
    let probe = target.join(format!(".atomic-probe-{}", Uuid::new_v4()));
    let moved = probe.with_extension("moved");
    fs::write(&probe, b"probe")?;
    fs::rename(&probe, &moved)?;
    fs::remove_file(moved)?;
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WizardPage {
    Intro,
    Location,
    Animation,
}

enum InstallEvent {
    Phase(InstallPhase),
    Completed(PathBuf),
    Failed(String),
    Canceled,
}

fn blit_pixmap(paint_data: &nwg::PaintData, pixmap: &tiny_skia::Pixmap) {
    let paint = paint_data.begin_paint();
    let width = pixmap.width();
    let height = pixmap.height();
    let mut bgra = Vec::with_capacity((width * height * 4) as usize);
    for rgba in pixmap.data().as_chunks::<4>().0 {
        // SetDIBitsToDevice expects bottom-up BGR(A) bytes. The negative
        // height below makes the bitmap top-down; the channel swap is still
        // required because tiny-skia stores pixels as RGBA.
        bgra.extend_from_slice(&[rgba[2], rgba[1], rgba[0], 255]);
    }
    let mut info: BITMAPINFO = unsafe { std::mem::zeroed() };
    info.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width as i32,
        biHeight: -(height as i32),
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB,
        ..unsafe { std::mem::zeroed() }
    };
    unsafe {
        SetDIBitsToDevice(
            paint.hdc,
            0,
            0,
            width,
            height,
            0,
            0,
            0,
            height,
            bgra.as_ptr() as *const _,
            &info,
            DIB_RGB_COLORS,
        );
    }
    paint_data.end_paint(&paint);
}

const ANIMATION_TRANSPARENT_COLOR: u32 = 3 | (9 << 8) | (24 << 16);

fn set_layered_animation_style(wizard: &InstallWizard, active: bool) {
    let Some(hwnd) = wizard.window.handle.hwnd() else {
        return;
    };
    let mut current_rect = RECT {
        left: 0,
        top: 0,
        right: NORMAL_WINDOW_SIZE.0,
        bottom: NORMAL_WINDOW_SIZE.1,
    };
    unsafe {
        GetWindowRect(hwnd, &mut current_rect);
    }
    let current_center = (
        (current_rect.left + current_rect.right) / 2,
        (current_rect.top + current_rect.bottom) / 2,
    );
    let (window_width, window_height) = if active {
        ANIMATION_WINDOW_SIZE
    } else {
        NORMAL_WINDOW_SIZE
    };
    let window_left = current_center.0 - window_width / 2;
    let window_top = current_center.1 - window_height / 2;
    let style = if active {
        (wizard.normal_window_style
            & !(WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_THICKFRAME))
            | WS_POPUP
            | WS_VISIBLE
    } else {
        wizard.normal_window_style
    };
    let ex_style = if active {
        wizard.normal_window_ex_style | WS_EX_LAYERED | WS_EX_TOOLWINDOW
    } else {
        wizard.normal_window_ex_style
    };
    let canvas_ex_style = if active {
        wizard.normal_canvas_ex_style | WS_EX_LAYERED
    } else {
        wizard.normal_canvas_ex_style
    };
    let canvas_visibility = if active {
        SWP_SHOWWINDOW
    } else {
        SWP_HIDEWINDOW
    };
    unsafe {
        SetWindowLongW(hwnd, GWL_STYLE, style as i32);
        SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style as i32);
        if let Some(canvas_hwnd) = wizard.animation_canvas.handle.hwnd() {
            // The full-window animation surface must never participate in the
            // normal Intro/Location pages. Lower it and hide it explicitly.
            SetWindowLongW(canvas_hwnd, GWL_EXSTYLE, canvas_ex_style as i32);
            if active {
                // Apply the same color key to the animation surface so its
                // key-colored backing surface cannot cover the transparent
                // parent while the borderless animation is running.
                SetLayeredWindowAttributes(
                    canvas_hwnd,
                    ANIMATION_TRANSPARENT_COLOR,
                    0,
                    LWA_COLORKEY,
                );
                SetWindowPos(
                    canvas_hwnd,
                    HWND_TOP,
                    0,
                    0,
                    window_width,
                    window_height,
                    SWP_NOACTIVATE | SWP_NOOWNERZORDER | canvas_visibility,
                );
            } else {
                SetWindowPos(
                    canvas_hwnd,
                    HWND_BOTTOM,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOMOVE | SWP_NOSIZE | SWP_HIDEWINDOW,
                );
                ShowWindow(canvas_hwnd, SW_HIDE);
            }
        }
        if active {
            SetLayeredWindowAttributes(hwnd, ANIMATION_TRANSPARENT_COLOR, 0, LWA_COLORKEY);
        }
        SetWindowPos(
            hwnd,
            HWND_TOP,
            window_left,
            window_top,
            window_width,
            window_height,
            SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
        );
    }
}

#[allow(dead_code)]
struct InstallWizard {
    window: nwg::Window,
    intro_page: nwg::Frame,
    location_page: nwg::Frame,
    intro_rule: nwg::Frame,
    location_rule: nwg::Frame,
    footer_rule: nwg::Frame,
    animation_canvas: nwg::ExternCanvas,
    icon_frame: nwg::ImageFrame,
    intro_title: nwg::Label,
    intro_body: nwg::Label,
    intro_version: nwg::Label,
    location_title: nwg::Label,
    location_body: nwg::Label,
    parent_label: nwg::Label,
    parent_input: nwg::TextInput,
    preview_label: nwg::Label,
    location_note: nwg::Label,
    browse_button: nwg::Button,
    back_button: nwg::Button,
    next_button: nwg::Button,
    cancel_button: nwg::Button,
    window_icon: nwg::Icon,
    icon_bitmap: nwg::Bitmap,
    title_font: nwg::Font,
    body_font: nwg::Font,
    button_font: nwg::Font,
    animation_timer: nwg::AnimationTimer,
    animation_renderer: RefCell<AnimationRenderer>,
    selected_parent: RefCell<PathBuf>,
    result: RefCell<Option<PathBuf>>,
    install_target: RefCell<Option<PathBuf>>,
    install_receiver: RefCell<Option<Receiver<InstallEvent>>>,
    cancel_flag: RefCell<Option<Arc<AtomicBool>>>,
    install_phase: Cell<InstallPhase>,
    completion_pending: Cell<bool>,
    completion_deadline: RefCell<Option<Instant>>,
    normal_window_style: u32,
    normal_window_ex_style: u32,
    normal_canvas_ex_style: u32,
    page: Cell<WizardPage>,
    handler: RefCell<Option<nwg::EventHandler>>,
}

impl InstallWizard {
    fn set_animation_phase(&self, phase: InstallPhase) {
        self.install_phase.set(phase);
        self.animation_renderer.borrow_mut().set_phase(phase);
    }

    fn show_location_page(&self) {
        self.page.set(WizardPage::Location);
        self.intro_page.set_visible(false);
        self.intro_version.set_position(40, 424);
        self.intro_version.set_visible(true);
        self.animation_canvas.set_visible(false);
        self.location_page.set_visible(true);
        self.footer_rule.set_visible(true);
        self.back_button.set_enabled(true);
        self.back_button.set_visible(true);
        self.next_button.set_enabled(true);
        self.next_button.set_visible(true);
        self.next_button.set_text("安装");
        self.cancel_button.set_text("取消");
        self.cancel_button.set_enabled(true);
        self.cancel_button.set_visible(true);
        set_layered_animation_style(self, false);
        self.next_button.set_focus();
        raise_control(&self.footer_rule.handle);
        raise_control(&self.intro_version.handle);
        raise_control(&self.back_button.handle);
        raise_control(&self.next_button.handle);
        raise_control(&self.cancel_button.handle);
        raise_control(&self.parent_input.handle);
        raise_control(&self.browse_button.handle);
    }

    fn show_intro_page(&self) {
        self.page.set(WizardPage::Intro);
        self.intro_page.set_visible(true);
        self.intro_version.set_position(40, 424);
        self.intro_version.set_visible(true);
        self.location_page.set_visible(false);
        self.animation_canvas.set_visible(false);
        self.footer_rule.set_visible(true);
        self.back_button.set_enabled(false);
        self.back_button.set_visible(true);
        self.next_button.set_enabled(true);
        self.next_button.set_visible(true);
        self.next_button.set_text("下一步");
        self.cancel_button.set_text("取消");
        self.cancel_button.set_enabled(true);
        self.cancel_button.set_visible(true);
        set_layered_animation_style(self, false);
        raise_control(&self.icon_frame.handle);
        raise_control(&self.footer_rule.handle);
        raise_control(&self.intro_version.handle);
        raise_control(&self.back_button.handle);
        raise_control(&self.next_button.handle);
        raise_control(&self.cancel_button.handle);
    }

    fn return_to_location(&self) {
        self.animation_timer.stop();
        self.install_receiver.borrow_mut().take();
        self.cancel_flag.borrow_mut().take();
        self.install_target.borrow_mut().take();
        self.completion_pending.set(false);
        self.completion_deadline.borrow_mut().take();
        self.show_location_page();
    }

    fn request_cancel(&self) {
        if let Some(cancel) = self.cancel_flag.borrow().as_ref() {
            cancel.store(true, Ordering::Release);
            self.cancel_button.set_enabled(false);
        }
    }

    fn finish_completed_install(&self) {
        self.animation_timer.stop();
        self.completion_pending.set(false);
        self.completion_deadline.borrow_mut().take();
        self.install_receiver.borrow_mut().take();
        self.cancel_flag.borrow_mut().take();
        if let Some(target) = self.install_target.borrow_mut().take() {
            *self.result.borrow_mut() = Some(target);
        }
        nwg::stop_thread_dispatch();
    }

    fn poll_install_events(&self) {
        let events = self
            .install_receiver
            .borrow()
            .as_ref()
            .map(|receiver| receiver.try_iter().collect::<Vec<_>>())
            .unwrap_or_default();

        for event in events {
            match event {
                InstallEvent::Phase(phase) => self.set_animation_phase(phase),
                InstallEvent::Completed(target) => {
                    *self.install_target.borrow_mut() = Some(target);
                    self.set_animation_phase(InstallPhase::Completed);
                    self.completion_pending.set(true);
                    let deadline = self
                        .animation_renderer
                        .borrow()
                        .next_cycle_deadline(Instant::now());
                    *self.completion_deadline.borrow_mut() = Some(deadline);
                }
                InstallEvent::Failed(message) => {
                    self.return_to_location();
                    nwg::modal_error_message(&self.window, "无法安装 BZ-Games", &message);
                }
                InstallEvent::Canceled => {
                    self.return_to_location();
                }
            }
        }

        if self.completion_pending.get()
            && self
                .completion_deadline
                .borrow()
                .is_some_and(|deadline| Instant::now() >= deadline)
        {
            self.finish_completed_install();
        }
    }

    fn start_install(&self, target: PathBuf) -> Result<()> {
        let (sender, receiver) = mpsc::channel();
        let cancel = Arc::new(AtomicBool::new(false));
        *self.install_receiver.borrow_mut() = Some(receiver);
        *self.cancel_flag.borrow_mut() = Some(cancel.clone());
        *self.install_target.borrow_mut() = Some(target.clone());
        self.result.borrow_mut().take();
        self.completion_pending.set(false);
        self.completion_deadline.borrow_mut().take();
        self.animation_renderer
            .borrow_mut()
            .restart_cycle(Instant::now());
        self.set_animation_phase(InstallPhase::Preparing);

        thread::Builder::new()
            .name("bz-games-velopack-install".to_string())
            .spawn(move || {
                if let Err(error) = install_payload(target, sender.clone(), cancel) {
                    let _ = sender.send(InstallEvent::Failed(format!("{error:#}")));
                }
            })
            .context("start background installer thread")?;

        self.page.set(WizardPage::Animation);
        self.intro_page.set_visible(false);
        self.intro_version.set_visible(false);
        self.location_page.set_visible(false);
        self.animation_canvas.set_visible(true);
        self.footer_rule.set_visible(false);
        self.back_button.set_visible(false);
        self.next_button.set_visible(false);
        self.cancel_button.set_visible(false);
        set_layered_animation_style(self, true);
        self.back_button.set_enabled(false);
        self.next_button.set_enabled(false);
        self.animation_timer.start();
        self.animation_canvas.invalidate();
        self.animation_canvas.set_focus();
        Ok(())
    }

    fn build(default_parent: &Path) -> Result<Rc<Self>> {
        nwg::init().map_err(|error| anyhow::anyhow!("initialize installer UI: {error:?}"))?;
        nwg::Font::set_global_family("Segoe UI")
            .map_err(|error| anyhow::anyhow!("set installer UI font: {error:?}"))?;

        // Keep a compact icon for the title bar.  The welcome-page image uses the
        // high-resolution PNG and is downscaled by WIC to the exact display size,
        // avoiding the soft result produced by resizing the legacy ICO handle.
        let mut window_icon = nwg::Icon::default();
        nwg::Icon::builder()
            .source_bin(Some(APP_ICON))
            .size(Some((32, 32)))
            .build(&mut window_icon)
            .map_err(|error| anyhow::anyhow!("load installer window icon: {error:?}"))?;
        let decoder = nwg::ImageDecoder::new()
            .map_err(|error| anyhow::anyhow!("create installer icon decoder: {error:?}"))?;
        let source = decoder
            .from_stream(APP_ICON_PNG)
            .map_err(|error| anyhow::anyhow!("decode installer display icon: {error:?}"))?;
        let frame = source
            .frame(0)
            .map_err(|error| anyhow::anyhow!("read installer display icon: {error:?}"))?;
        let resized = decoder
            .resize_image(&frame, [96, 96])
            .map_err(|error| anyhow::anyhow!("resize installer display icon: {error:?}"))?;
        let icon_bitmap = resized
            .as_bitmap()
            .map_err(|error| anyhow::anyhow!("create installer display bitmap: {error:?}"))?;
        let mut title_font = nwg::Font::default();
        nwg::Font::builder()
            .family("Segoe UI")
            .size(36)
            .weight(700)
            .build(&mut title_font)
            .map_err(|error| anyhow::anyhow!("create installer title font: {error:?}"))?;
        let mut body_font = nwg::Font::default();
        nwg::Font::builder()
            .family("Segoe UI")
            .size(24)
            .build(&mut body_font)
            .map_err(|error| anyhow::anyhow!("create installer body font: {error:?}"))?;
        let mut button_font = nwg::Font::default();
        nwg::Font::builder()
            .family("Segoe UI")
            .size(20)
            .weight(600)
            .build(&mut button_font)
            .map_err(|error| anyhow::anyhow!("create installer button font: {error:?}"))?;

        let mut window = nwg::Window::default();
        nwg::Window::builder()
            // Keep the frame hidden while both page trees are being built. The
            // Intro page is selected only after the Location page has been
            // hidden, so users never see the wrong page during startup.
            .flags(nwg::WindowFlags::WINDOW)
            .size(NORMAL_WINDOW_SIZE)
            .center(true)
            .title("BZ-Games 安装")
            .icon(Some(&window_icon))
            .build(&mut window)
            .map_err(|error| anyhow::anyhow!("create installer window: {error:?}"))?;

        let mut intro_page = nwg::Frame::default();
        nwg::Frame::builder()
            .flags(nwg::FrameFlags::VISIBLE)
            .size((760, 410))
            .position((0, 0))
            .parent(&window)
            .build(&mut intro_page)
            .map_err(|error| anyhow::anyhow!("create installer introduction page: {error:?}"))?;
        let mut location_page = nwg::Frame::default();
        nwg::Frame::builder()
            .flags(nwg::FrameFlags::VISIBLE)
            .size((760, 410))
            .position((0, 0))
            .parent(&window)
            .build(&mut location_page)
            .map_err(|error| anyhow::anyhow!("create installer location page: {error:?}"))?;

        let mut animation_canvas = nwg::ExternCanvas::default();
        nwg::ExternCanvas::builder()
            .flags(nwg::ExternCanvasFlags::VISIBLE)
            .size(NORMAL_WINDOW_SIZE)
            .position((0, 0))
            .parent(Some(&window))
            .build(&mut animation_canvas)
            .map_err(|error| anyhow::anyhow!("create installer animation canvas: {error:?}"))?;

        let mut intro_rule = nwg::Frame::default();
        nwg::Frame::builder()
            .flags(nwg::FrameFlags::VISIBLE | nwg::FrameFlags::BORDER)
            .size((680, 1))
            .position((40, 105))
            .parent(&intro_page)
            .build(&mut intro_rule)
            .map_err(|error| {
                anyhow::anyhow!("create installer introduction separator: {error:?}")
            })?;

        let mut location_rule = nwg::Frame::default();
        nwg::Frame::builder()
            .flags(nwg::FrameFlags::VISIBLE | nwg::FrameFlags::BORDER)
            .size((680, 1))
            .position((40, 105))
            .parent(&location_page)
            .build(&mut location_rule)
            .map_err(|error| anyhow::anyhow!("create installer location separator: {error:?}"))?;

        let mut footer_rule = nwg::Frame::default();
        nwg::Frame::builder()
            .flags(nwg::FrameFlags::VISIBLE | nwg::FrameFlags::BORDER)
            .size((720, 1))
            .position((20, 414))
            .parent(&window)
            .build(&mut footer_rule)
            .map_err(|error| anyhow::anyhow!("create installer footer separator: {error:?}"))?;

        let mut icon_frame = nwg::ImageFrame::default();
        nwg::ImageFrame::builder()
            .bitmap(Some(&icon_bitmap))
            .size((112, 112))
            .position((620, 18))
            .parent(&intro_page)
            .build(&mut icon_frame)
            .map_err(|error| anyhow::anyhow!("create installer icon: {error:?}"))?;

        let mut intro_title = nwg::Label::default();
        nwg::Label::builder()
            .text("欢迎安装 BZ-Games")
            .font(Some(&title_font))
            .size((540, 52))
            .position((40, 28))
            .parent(&intro_page)
            .build(&mut intro_title)
            .map_err(|error| anyhow::anyhow!("create installer introduction title: {error:?}"))?;
        let mut intro_body = nwg::Label::default();
        nwg::Label::builder()
            .text("BZ-Games 是一个本地优先的 Windows 游戏平台，专为 Windows 设计。\r\n它允许用户导入本地游戏，并通过内置的 P2P 联机房间系统\r\n与好友进行多人游戏。\r\n支持局域网自动发现、用户自备 frp 直连、官方中继短地址三种联机入口，\r\n并提供 GitHub OAuth 登录与云端数据同步服务。")
            .font(Some(&body_font))
            .size((680, 200))
            .position((40, 130))
            .parent(&intro_page)
            .build(&mut intro_body)
            .map_err(|error| anyhow::anyhow!("create installer introduction text: {error:?}"))?;
        let mut intro_version = nwg::Label::default();
        nwg::Label::builder()
            .text(&format!("当前版本  {}", app_version()))
            .font(Some(&body_font))
            .size((340, 32))
            .position((40, 424))
            .flags(nwg::LabelFlags::VISIBLE | nwg::LabelFlags::DISABLED)
            .parent(&window)
            .build(&mut intro_version)
            .map_err(|error| anyhow::anyhow!("create installer version text: {error:?}"))?;

        let mut location_title = nwg::Label::default();
        nwg::Label::builder()
            .text("选定安装位置")
            .font(Some(&title_font))
            .size((540, 52))
            .position((40, 28))
            .parent(&location_page)
            .build(&mut location_title)
            .map_err(|error| anyhow::anyhow!("create installer location title: {error:?}"))?;
        let mut location_body = nwg::Label::default();
        nwg::Label::builder()
            .text("默认安装到下列文件夹。需要安装到其他磁盘时，可点击“更改安装位置”选择父目录，程序会自动创建 BZ-Games 子目录。")
            .font(Some(&body_font))
            .size((680, 88))
            .position((40, 132))
            .parent(&location_page)
            .build(&mut location_body)
            .map_err(|error| anyhow::anyhow!("create installer location text: {error:?}"))?;
        let mut parent_label = nwg::Label::default();
        nwg::Label::builder()
            .text("目标文件夹")
            .font(Some(&body_font))
            .size((120, 34))
            .position((64, 250))
            .parent(&location_page)
            .build(&mut parent_label)
            .map_err(|error| anyhow::anyhow!("create installer parent label: {error:?}"))?;
        let default_target_text = installation_root(default_parent)
            .to_string_lossy()
            .to_string();
        let mut parent_input = nwg::TextInput::default();
        nwg::TextInput::builder()
            .text(&default_target_text)
            .readonly(true)
            // Keep paths readable from the drive letter to the final folder.
            // A compact single-line edit height lets the native edit control
            // vertically center the current body font instead of leaving it
            // visibly high inside an oversized box.
            .align(nwg::HTextAlign::Left)
            .font(Some(&body_font))
            // Leave a fixed gap before the browse button. Long paths can
            // still be inspected by horizontal scrolling in the read-only
            // input instead of being covered by the button.
            .size((335, 36))
            .position((190, 244))
            .parent(&location_page)
            .build(&mut parent_input)
            .map_err(|error| anyhow::anyhow!("create installer parent input: {error:?}"))?;
        let mut browse_button = nwg::Button::default();
        nwg::Button::builder()
            .text("更改安装位置")
            .font(Some(&button_font))
            .size((145, 46))
            .position((545, 239))
            .parent(&location_page)
            .build(&mut browse_button)
            .map_err(|error| anyhow::anyhow!("create installer browse button: {error:?}"))?;
        let mut preview_label = nwg::Label::default();
        nwg::Label::builder()
            .text(&required_install_size_text())
            .font(Some(&body_font))
            .size((640, 36))
            .position((64, 292))
            .parent(&location_page)
            .build(&mut preview_label)
            .map_err(|error| anyhow::anyhow!("create installer preview text: {error:?}"))?;
        let mut location_note = nwg::Label::default();
        nwg::Label::builder()
            .text(&available_space_text(default_parent))
            .font(Some(&body_font))
            .size((640, 55))
            .position((64, 335))
            .flags(nwg::LabelFlags::VISIBLE | nwg::LabelFlags::DISABLED)
            .parent(&location_page)
            .build(&mut location_note)
            .map_err(|error| anyhow::anyhow!("create installer location note: {error:?}"))?;

        let mut back_button = nwg::Button::default();
        nwg::Button::builder()
            .text("上一步")
            .font(Some(&button_font))
            .size((96, 36))
            .position((430, 422))
            .enabled(false)
            .parent(&window)
            .build(&mut back_button)
            .map_err(|error| anyhow::anyhow!("create installer back button: {error:?}"))?;
        let mut next_button = nwg::Button::default();
        nwg::Button::builder()
            .text("下一步")
            .font(Some(&button_font))
            .size((96, 36))
            .position((535, 422))
            .focus(true)
            .parent(&window)
            .build(&mut next_button)
            .map_err(|error| anyhow::anyhow!("create installer next button: {error:?}"))?;
        let mut cancel_button = nwg::Button::default();
        nwg::Button::builder()
            .text("取消")
            .font(Some(&button_font))
            .size((96, 36))
            .position((640, 422))
            .parent(&window)
            .build(&mut cancel_button)
            .map_err(|error| anyhow::anyhow!("create installer cancel button: {error:?}"))?;

        let animation_renderer = AnimationRenderer::new(
            APP_ICON_PNG,
            [APP_ICON_Q1, APP_ICON_Q2, APP_ICON_Q3, APP_ICON_Q4],
        )?;
        let mut animation_timer = nwg::AnimationTimer::default();
        nwg::AnimationTimer::builder()
            .parent(&window)
            .interval(Duration::from_millis(16))
            .active(false)
            .build(&mut animation_timer)
            .map_err(|error| anyhow::anyhow!("create installer animation timer: {error:?}"))?;

        let window_handle = window
            .handle
            .hwnd()
            .context("installer window handle is unavailable")?;
        let animation_canvas_handle = animation_canvas
            .handle
            .hwnd()
            .context("installer animation canvas handle is unavailable")?;
        let (normal_window_style, normal_window_ex_style) = unsafe {
            (
                GetWindowLongW(window_handle, GWL_STYLE) as u32,
                GetWindowLongW(window_handle, GWL_EXSTYLE) as u32,
            )
        };
        let normal_canvas_ex_style =
            unsafe { GetWindowLongW(animation_canvas_handle, GWL_EXSTYLE) as u32 };
        location_page.set_visible(false);
        animation_canvas.set_visible(false);
        let wizard = Rc::new(Self {
            window,
            intro_page,
            location_page,
            intro_rule,
            location_rule,
            footer_rule,
            animation_canvas,
            icon_frame,
            intro_title,
            intro_body,
            intro_version,
            location_title,
            location_body,
            parent_label,
            parent_input,
            preview_label,
            location_note,
            browse_button,
            back_button,
            next_button,
            cancel_button,
            window_icon,
            icon_bitmap,
            title_font,
            body_font,
            button_font,
            animation_timer,
            animation_renderer: RefCell::new(animation_renderer),
            selected_parent: RefCell::new(default_parent.to_path_buf()),
            result: RefCell::new(None),
            install_target: RefCell::new(None),
            install_receiver: RefCell::new(None),
            cancel_flag: RefCell::new(None),
            install_phase: Cell::new(InstallPhase::Preparing),
            completion_pending: Cell::new(false),
            completion_deadline: RefCell::new(None),
            normal_window_style,
            normal_window_ex_style,
            normal_canvas_ex_style,
            page: Cell::new(WizardPage::Intro),
            handler: RefCell::new(None),
        });
        wizard.show_intro_page();

        let events_wizard = wizard.clone();
        let handler = nwg::full_bind_event_handler(
            &wizard.window.handle,
            move |event, event_data, handle| match event {
                nwg::Event::OnPaint if handle == events_wizard.animation_canvas.handle => {
                    let paint_data = event_data.on_paint();
                    let (width, height) = events_wizard.animation_canvas.physical_size();
                    if let Ok(frame) = events_wizard.animation_renderer.borrow().render(
                        width,
                        height,
                        Instant::now(),
                    ) {
                        blit_pixmap(paint_data, &frame);
                    }
                }
                nwg::Event::OnTimerTick if handle == events_wizard.animation_timer.handle => {
                    events_wizard.poll_install_events();
                    if events_wizard.page.get() == WizardPage::Animation {
                        events_wizard.animation_canvas.invalidate();
                    }
                }
                nwg::Event::OnKeyPress
                    if events_wizard.page.get() == WizardPage::Animation
                        && !events_wizard.completion_pending.get()
                        && event_data.on_key() == nwg::keys::ESCAPE =>
                {
                    events_wizard.request_cancel();
                }
                nwg::Event::OnWindowClose if handle == events_wizard.window.handle => {
                    if events_wizard.page.get() == WizardPage::Animation
                        && !events_wizard.completion_pending.get()
                        && matches!(
                            events_wizard.install_phase.get(),
                            InstallPhase::Preparing
                                | InstallPhase::Installing
                                | InstallPhase::Finalizing
                        )
                    {
                        if let nwg::EventData::OnWindowClose(close_data) = event_data {
                            close_data.close(false);
                        }
                        events_wizard.request_cancel();
                    } else {
                        nwg::stop_thread_dispatch();
                    }
                }
                nwg::Event::OnButtonClick if handle == events_wizard.cancel_button.handle => {
                    if events_wizard.page.get() != WizardPage::Animation {
                        nwg::stop_thread_dispatch();
                    } else {
                        match events_wizard.install_phase.get() {
                            InstallPhase::Preparing
                            | InstallPhase::Installing
                            | InstallPhase::Finalizing => events_wizard.request_cancel(),
                            InstallPhase::Completed => {}
                        }
                    }
                }
                nwg::Event::OnButtonClick if handle == events_wizard.browse_button.handle => {
                    if events_wizard.page.get() != WizardPage::Location {
                        return;
                    }
                    let current_parent = events_wizard.selected_parent.borrow().clone();
                    let mut dialog = nwg::FileDialog::default();
                    let dialog_result = nwg::FileDialog::builder()
                        .title("选择 BZ-Games 安装父目录")
                        .action(nwg::FileDialogAction::OpenDirectory)
                        .default_folder(current_parent.to_string_lossy())
                        .build(&mut dialog);
                    match dialog_result {
                        Err(error) => {
                            nwg::modal_error_message(
                                &events_wizard.window,
                                "无法打开文件夹选择器",
                                &format!("{error:?}"),
                            );
                        }
                        Ok(()) => {
                            // A false result is the normal user-cancel path.
                            // Keep cancellation silent, but handle the dialog
                            // result explicitly instead of hiding it in a match
                            // guard where failures are indistinguishable.
                            if !dialog.run(Some(events_wizard.window.handle)) {
                                return;
                            }
                            match dialog.get_selected_item() {
                                Ok(selected_os) => {
                                    let selected = PathBuf::from(selected_os);
                                    let preview = installation_root(&selected);
                                    events_wizard
                                        .parent_input
                                        .set_text(&preview.to_string_lossy());
                                    events_wizard
                                        .location_note
                                        .set_text(&available_space_text(&preview));
                                    *events_wizard.selected_parent.borrow_mut() = selected;
                                }
                                Err(error) => {
                                    nwg::modal_error_message(
                                        &events_wizard.window,
                                        "无法读取文件夹",
                                        &format!("{error:?}"),
                                    );
                                }
                            }
                        }
                    }
                }
                nwg::Event::OnButtonClick if handle == events_wizard.back_button.handle => {
                    if events_wizard.page.get() == WizardPage::Location {
                        events_wizard.show_intro_page();
                    }
                }
                nwg::Event::OnButtonClick if handle == events_wizard.next_button.handle => {
                    if events_wizard.page.get() == WizardPage::Intro {
                        events_wizard.show_location_page();
                        // Showing a sibling page can change the child z-order on
                        // some Windows themes. Raise interactive controls after
                        // the page becomes visible so mouse hit-testing always
                        // reaches them.
                        raise_control(&events_wizard.parent_input.handle);
                        raise_control(&events_wizard.browse_button.handle);
                    } else {
                        let parent = events_wizard.selected_parent.borrow().clone();
                        let target = installation_root(&parent);
                        match validate_target(&target) {
                            Ok(()) => {
                                if let Err(error) = events_wizard.start_install(target) {
                                    events_wizard.return_to_location();
                                    nwg::modal_error_message(
                                        &events_wizard.window,
                                        "无法启动安装",
                                        &format!("{error:#}"),
                                    );
                                }
                            }
                            Err(error) => {
                                nwg::modal_error_message(
                                    &events_wizard.window,
                                    "无法安装",
                                    &format!("{error:#}"),
                                );
                            }
                        }
                    }
                }
                _ => {}
            },
        );
        *wizard.handler.borrow_mut() = Some(handler);
        Ok(wizard)
    }
}

fn show_install_wizard(default_parent: &Path) -> Result<Option<PathBuf>> {
    let wizard = InstallWizard::build(default_parent)?;
    nwg::dispatch_thread_events();
    if let Some(handler) = wizard.handler.borrow_mut().take() {
        nwg::unbind_event_handler(&handler);
    }
    let result = wizard.result.borrow_mut().take();
    Ok(result)
}

fn install_payload(
    target: PathBuf,
    sender: Sender<InstallEvent>,
    cancel: Arc<AtomicBool>,
) -> Result<()> {
    let temporary = std::env::temp_dir().join(format!("bz-games-installer-{}", Uuid::new_v4()));
    let operation = (|| {
        let _ = sender.send(InstallEvent::Phase(InstallPhase::Preparing));
        if cancel.load(Ordering::Acquire) {
            let _ = sender.send(InstallEvent::Canceled);
            return Ok(());
        }

        fs::create_dir_all(&temporary).context("create temporary installer directory")?;
        let setup = temporary.join("Setup.exe");
        let log_path = temporary.join("velopack-install.log");
        fs::write(&setup, VELOPACK_SETUP).context("write temporary Velopack installer")?;
        if cancel.load(Ordering::Acquire) {
            let _ = fs::remove_dir_all(&target);
            let _ = sender.send(InstallEvent::Canceled);
            return Ok(());
        }
        let runtime = target.join(".runtime");
        let mut child = Command::new(&setup)
            .arg("--silent")
            .arg("--installto")
            .arg(&runtime)
            .arg("--log")
            .arg(&log_path)
            .spawn()
            .context("start Velopack installer")?;
        let _ = sender.send(InstallEvent::Phase(InstallPhase::Installing));

        let status = loop {
            if cancel.load(Ordering::Acquire) {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_dir_all(&target);
                let _ = sender.send(InstallEvent::Canceled);
                return Ok(());
            }
            match child.try_wait().context("wait for Velopack installer")? {
                Some(status) => break status,
                None => thread::sleep(Duration::from_millis(100)),
            }
        };
        if !status.success() {
            bail!("Velopack installation failed with {status}");
        }
        if cancel.load(Ordering::Acquire) {
            let _ = fs::remove_dir_all(&target);
            let _ = sender.send(InstallEvent::Canceled);
            return Ok(());
        }

        let _ = sender.send(InstallEvent::Phase(InstallPhase::Finalizing));
        fs::write(target.join("BZ-Games.exe"), ROOT_LAUNCHER)
            .context("write BZ-Games root launcher")?;
        fs::write(target.join("BZ-Games-Uninstall.exe"), ROOT_UNINSTALLER)
            .context("write BZ-Games root uninstaller")?;
        fs::write(target.join(".bz-games-root"), b"bz-games-root-v1\n")?;
        fs::create_dir_all(target.join("games"))?;
        fs::create_dir_all(target.join("db"))?;
        register_shell(&target)?;
        let _ = sender.send(InstallEvent::Completed(target.clone()));
        Ok(())
    })();

    // The Setup executable, its log and the unpacking staging directory are
    // private to this run. They are never left behind after success, cancel or
    // failure; the Velopack runtime itself remains under the selected target.
    let _ = fs::remove_dir_all(&temporary);
    if operation.is_err() {
        // The selected target was verified empty before this worker started,
        // so a failed Velopack run can safely be retried from the Location
        // page without inheriting a partial .runtime directory.
        let _ = fs::remove_dir_all(&target);
    }
    operation
}

fn install_payload_sync(target: &Path) -> Result<()> {
    let (sender, _receiver) = mpsc::channel();
    install_payload(
        target.to_path_buf(),
        sender,
        Arc::new(AtomicBool::new(false)),
    )
}

fn cli_install_target() -> Result<Option<PathBuf>> {
    let mut args = std::env::args().skip(1);
    while let Some(argument) = args.next() {
        if argument == "--install-dir" {
            let value = args
                .next()
                .context("--install-dir requires an installation path")?;
            let selected = PathBuf::from(value);
            return Ok(Some(if selected.is_absolute() {
                selected
            } else {
                std::env::current_dir()?.join(selected)
            }));
        }
    }
    Ok(None)
}

fn run() -> Result<()> {
    if VELOPACK_SETUP.is_empty() || ROOT_LAUNCHER.is_empty() || ROOT_UNINSTALLER.is_empty() {
        bail!("installer payload was not embedded by the release build");
    }

    if let Some(target) = cli_install_target()? {
        validate_target(&target)?;
        install_payload_sync(&target)?;
        Command::new(target.join("BZ-Games.exe"))
            .spawn()
            .context("start BZ-Games")?;
        return Ok(());
    }

    let default = default_root()?;
    let default_parent = default
        .parent()
        .context("default installation parent is unavailable")?;
    fs::create_dir_all(default_parent)?;
    let Some(target) = show_install_wizard(default_parent)? else {
        return Ok(());
    };
    Command::new(target.join("BZ-Games.exe"))
        .spawn()
        .context("start BZ-Games")?;
    Ok(())
}

fn register_shell(target: &Path) -> Result<()> {
    let launcher = target.join("BZ-Games.exe");
    let uninstaller = target.join("BZ-Games-Uninstall.exe");
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (protocol, _) = hkcu.create_subkey(r"Software\Classes\bzgames")?;
    protocol.set_value("", &"URL:BZ-Games Protocol")?;
    protocol.set_value("URL Protocol", &"")?;
    let (command, _) = protocol.create_subkey(r"shell\open\command")?;
    command.set_value("", &format!("\"{}\" \"%1\"", launcher.display()))?;

    let (uninstall, _) = hkcu.create_subkey(
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall\com.bzgames.desktop",
    )?;
    uninstall.set_value("DisplayName", &"BZ-Games")?;
    uninstall.set_value("DisplayVersion", &app_version())?;
    uninstall.set_value("Publisher", &"baozha2023")?;
    uninstall.set_value("InstallLocation", &target.to_string_lossy().as_ref())?;
    uninstall.set_value(
        "UninstallString",
        &format!("\"{}\" --system", uninstaller.display()),
    )?;
    let _ = uninstall.delete_value("QuietUninstallString");

    for shortcut in [
        dirs::desktop_dir().map(|dir| dir.join("BZ-Games.lnk")),
        dirs::data_dir().map(|dir| dir.join(r"Microsoft\Windows\Start Menu\Programs\BZ-Games.lnk")),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(parent) = shortcut.parent() {
            fs::create_dir_all(parent)?;
        }
        let link = ShellLink::new(&launcher)?;
        link.create_lnk(shortcut)?;
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        MessageDialog::new()
            .set_level(MessageLevel::Error)
            .set_title("BZ-Games Setup")
            .set_description(format!("Installation failed:\n{error:#}"))
            .show();
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::installation_root;
    use std::path::Path;

    #[test]
    fn installation_root_adds_bz_games_directory_once() {
        assert_eq!(
            installation_root(Path::new(r"D:\Games")),
            Path::new(r"D:\Games\BZ-Games")
        );
        assert_eq!(
            installation_root(Path::new(r"D:\Games\BZ-Games")),
            Path::new(r"D:\Games\BZ-Games")
        );
        assert_eq!(
            installation_root(Path::new(r"D:\Games\bz-games")),
            Path::new(r"D:\Games\bz-games")
        );
    }
}
