#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[path = "../bootstrap_locale.rs"]
mod bootstrap_locale;
#[path = "../bootstrap_ui.rs"]
mod bootstrap_ui;
#[path = "../installer_animation.rs"]
mod installer_animation;

use anyhow::{bail, Context, Result};
use bootstrap_locale::{detect_user_locale, BootstrapLocale};
use bootstrap_ui::{
    BODY_FONT_SIZE, BUTTON_FONT_SIZE, BUTTON_FONT_WEIGHT, FONT_FAMILY, TITLE_FONT_SIZE,
    TITLE_FONT_WEIGHT, WINDOW_ICON_SIZE,
};
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
use winapi::shared::windef::{HBITMAP, HDC, HGDIOBJ, POINT, RECT, SIZE};
use winapi::um::wingdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, AC_SRC_ALPHA,
    AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS, HGDI_ERROR,
};
use winapi::um::winuser::{
    GetDpiForWindow, GetMonitorInfoW, GetWindowLongW, GetWindowRect, MonitorFromWindow,
    SetWindowLongW, SetWindowPos, UpdateLayeredWindow, GWL_EXSTYLE, GWL_STYLE, HWND_TOP,
    MONITORINFO, MONITOR_DEFAULTTONEAREST, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_SHOWWINDOW, ULW_ALPHA, WS_CAPTION, WS_EX_LAYERED,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT, WS_MAXIMIZEBOX, WS_MINIMIZEBOX,
    WS_POPUP, WS_SYSMENU, WS_THICKFRAME, WS_VISIBLE,
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
const FOOTER_RULE_Y: i32 = 450;
const FOOTER_CONTROLS_Y: i32 = 458;
// Logical size at 96 DPI. The native layered surface scales this square to the
// current monitor while keeping the entire fragment motion envelope visible.
const ANIMATION_WINDOW_LOGICAL_SIZE: i32 = 1080;

struct InstallerStrings {
    window_title: &'static str,
    welcome_title: &'static str,
    welcome_body: &'static str,
    current_version: &'static str,
    location_title: &'static str,
    location_body: &'static str,
    target_folder: &'static str,
    change_location: &'static str,
    required_space: &'static str,
    required_space_unknown: &'static str,
    available_space: &'static str,
    available_space_unknown: &'static str,
    back: &'static str,
    next: &'static str,
    install: &'static str,
    cancel: &'static str,
    choose_parent: &'static str,
    picker_failed: &'static str,
    folder_failed: &'static str,
    start_failed: &'static str,
    install_failed: &'static str,
    unsupported_path: &'static str,
    occupied_directory: &'static str,
    fatal_prefix: &'static str,
}

const fn installer_strings(locale: BootstrapLocale) -> InstallerStrings {
    match locale {
        BootstrapLocale::ZhCn => InstallerStrings {
            window_title: "BZ-Games 安装",
            welcome_title: "欢迎安装 BZ-Games",
            welcome_body: "BZ-Games 是面向 Windows 的本地优先游戏平台。\r\n你可以导入和管理本地游戏，并通过房间与好友联机。\r\n支持局域网发现、自备直连地址和官方中继短地址，\r\n同时提供游戏市场、成就、统计与账号服务。",
            current_version: "当前版本",
            location_title: "选定安装位置",
            location_body: "默认安装到下列文件夹。需要安装到其他磁盘时，可点击“更改安装位置”选择父目录，程序会自动创建 BZ-Games 子目录。",
            target_folder: "目标文件夹",
            change_location: "更改安装位置",
            required_space: "所需空间：约",
            required_space_unknown: "所需空间：安装后大小由当前版本决定",
            available_space: "可用空间：",
            available_space_unknown: "可用空间：无法获取",
            back: "上一步",
            next: "下一步",
            install: "安装",
            cancel: "取消",
            choose_parent: "选择 BZ-Games 安装父目录",
            picker_failed: "无法打开文件夹选择器",
            folder_failed: "无法读取文件夹",
            start_failed: "无法启动安装",
            install_failed: "无法安装 BZ-Games",
            unsupported_path: "不支持此安装路径",
            occupied_directory: "所选目录已被占用，请选择新的空目录",
            fatal_prefix: "安装失败：",
        },
        BootstrapLocale::ZhTw => InstallerStrings {
            window_title: "BZ-Games 安裝",
            welcome_title: "歡迎安裝 BZ-Games",
            welcome_body: "BZ-Games 是面向 Windows 的本機優先遊戲平台。\r\n你可以匯入和管理本機遊戲，並透過房間與好友連線遊玩。\r\n支援區域網路探索、自備直連位址和官方中繼短位址，\r\n同時提供遊戲市集、成就、統計與帳號服務。",
            current_version: "目前版本",
            location_title: "選擇安裝位置",
            location_body: "預設安裝到下列資料夾。如需安裝到其他磁碟，請選擇父目錄，程式會自動建立 BZ-Games 子目錄。",
            target_folder: "目標資料夾",
            change_location: "變更安裝位置",
            required_space: "所需空間：約",
            required_space_unknown: "所需空間：由目前版本的安裝大小決定",
            available_space: "可用空間：",
            available_space_unknown: "可用空間：無法取得",
            back: "上一步",
            next: "下一步",
            install: "安裝",
            cancel: "取消",
            choose_parent: "選擇 BZ-Games 安裝父目錄",
            picker_failed: "無法開啟資料夾選擇器",
            folder_failed: "無法讀取資料夾",
            start_failed: "無法啟動安裝",
            install_failed: "無法安裝 BZ-Games",
            unsupported_path: "不支援此安裝路徑",
            occupied_directory: "所選目錄已被使用，請選擇新的空目錄",
            fatal_prefix: "安裝失敗：",
        },
        BootstrapLocale::JaJp => InstallerStrings {
            window_title: "BZ-Games セットアップ",
            welcome_title: "BZ-Games へようこそ",
            welcome_body: "BZ-Games は Windows 向けのローカルファーストなゲームプラットフォームです。\r\nローカルゲームを取り込み、ルームを通じて友達とプレイできます。\r\nLAN 検出、独自の直接接続先、公式リレーの短縮アドレスに対応し、\r\nゲーム市場、実績、統計、アカウント機能も利用できます。",
            current_version: "現在のバージョン",
            location_title: "インストール先の選択",
            location_body: "既定では次のフォルダーにインストールします。別のドライブを使う場合は親フォルダーを選択してください。BZ-Games サブフォルダーは自動的に作成されます。",
            target_folder: "インストール先",
            change_location: "場所を変更",
            required_space: "必要な容量：約",
            required_space_unknown: "必要な容量：このバージョンのインストールサイズによります",
            available_space: "空き容量：",
            available_space_unknown: "空き容量：取得できません",
            back: "戻る",
            next: "次へ",
            install: "インストール",
            cancel: "キャンセル",
            choose_parent: "BZ-Games のインストール先親フォルダーを選択",
            picker_failed: "フォルダー選択画面を開けません",
            folder_failed: "フォルダーを読み取れません",
            start_failed: "インストールを開始できません",
            install_failed: "BZ-Games をインストールできません",
            unsupported_path: "このインストール先は使用できません",
            occupied_directory: "選択したフォルダーは空ではありません。新しい空のフォルダーを選択してください",
            fatal_prefix: "インストールに失敗しました：",
        },
        BootstrapLocale::DeDe => InstallerStrings {
            window_title: "BZ-Games installieren",
            welcome_title: "Willkommen bei BZ-Games",
            welcome_body: "BZ-Games ist eine lokal orientierte Spieleplattform für Windows.\r\nImportiere und verwalte lokale Spiele und spiele über Räume mit Freunden.\r\nUnterstützt werden LAN-Suche, eigene Direktadressen und der offizielle Relay,\r\nsowie Spielemarkt, Erfolge, Statistiken und Kontodienste.",
            current_version: "Aktuelle Version",
            location_title: "Installationsort wählen",
            location_body: "Standardmäßig wird der folgende Ordner verwendet. Wähle für ein anderes Laufwerk den übergeordneten Ordner; der Unterordner BZ-Games wird automatisch erstellt.",
            target_folder: "Zielordner",
            change_location: "Ordner ändern",
            required_space: "Benötigter Speicher: ca.",
            required_space_unknown: "Benötigter Speicher: abhängig von dieser Version",
            available_space: "Freier Speicher: ",
            available_space_unknown: "Freier Speicher: nicht verfügbar",
            back: "Zurück",
            next: "Weiter",
            install: "Installieren",
            cancel: "Abbrechen",
            choose_parent: "Übergeordneten Installationsordner für BZ-Games wählen",
            picker_failed: "Ordnerauswahl konnte nicht geöffnet werden",
            folder_failed: "Ordner konnte nicht gelesen werden",
            start_failed: "Installation konnte nicht gestartet werden",
            install_failed: "BZ-Games konnte nicht installiert werden",
            unsupported_path: "Dieser Installationspfad wird nicht unterstützt",
            occupied_directory: "Der gewählte Ordner ist nicht leer. Wähle einen neuen leeren Ordner",
            fatal_prefix: "Installation fehlgeschlagen:",
        },
        BootstrapLocale::EnUs => InstallerStrings {
            window_title: "BZ-Games Setup",
            welcome_title: "Welcome to BZ-Games",
            welcome_body: "BZ-Games is a local-first game platform for Windows.\r\nImport and manage local games, then play with friends through rooms.\r\nConnect through LAN discovery, your own direct address, or the official relay,\r\nwith game market, achievements, statistics, and account services.",
            current_version: "Current version",
            location_title: "Choose install location",
            location_body: "BZ-Games will be installed in the folder below. To use another drive, choose its parent folder and the BZ-Games subfolder will be created automatically.",
            target_folder: "Destination",
            change_location: "Change folder",
            required_space: "Required space: about",
            required_space_unknown: "Required space: depends on this version's installed size",
            available_space: "Available space: ",
            available_space_unknown: "Available space: unavailable",
            back: "Back",
            next: "Next",
            install: "Install",
            cancel: "Cancel",
            choose_parent: "Choose the parent folder for BZ-Games",
            picker_failed: "Could not open the folder picker",
            folder_failed: "Could not read the folder",
            start_failed: "Could not start installation",
            install_failed: "Could not install BZ-Games",
            unsupported_path: "This installation path is not supported",
            occupied_directory: "The selected directory is not empty. Choose a new empty directory",
            fatal_prefix: "Installation failed:",
        },
    }
}

fn monitor_work_area(hwnd: winapi::shared::windef::HWND) -> Option<RECT> {
    // SAFETY: `hwnd` comes from the live installer window; nearest-monitor
    // lookup also has defined behavior if Windows has begun destroying it.
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    // SAFETY: an all-zero `MONITORINFO` is valid once `cbSize` is populated.
    let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    // SAFETY: `info` is writable and correctly sized; `monitor` is checked
    // before it is passed to Win32.
    if monitor.is_null() || unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
        None
    } else {
        Some(info.rcWork)
    }
}

const fn centered_window_origin(area: &RECT, width: i32, height: i32) -> (i32, i32) {
    (
        area.left + (area.right - area.left - width) / 2,
        area.top + (area.bottom - area.top - height) / 2,
    )
}

const fn window_ex_style(normal_style: u32, animation_active: bool) -> u32 {
    if animation_active {
        normal_style | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT
    } else {
        normal_style
    }
}

fn animation_window_size(
    hwnd: winapi::shared::windef::HWND,
    work_area: Option<&RECT>,
) -> (i32, i32) {
    // SAFETY: `hwnd` is the live installer window handle.
    let dpi_scale = unsafe { GetDpiForWindow(hwnd) }.max(96) as f32 / 96.0;
    let desired = (ANIMATION_WINDOW_LOGICAL_SIZE as f32 * dpi_scale).round() as i32;
    let Some(work_area) = work_area else {
        return (desired, desired);
    };
    let work_width = work_area.right - work_area.left;
    let work_height = work_area.bottom - work_area.top;
    let limit = ((work_width.min(work_height) as f32) * 0.96).round() as i32;
    let size = desired.min(limit).max(1);
    (size, size)
}

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

fn required_install_size_text(text: &InstallerStrings) -> String {
    option_env!("BZ_INSTALLED_SIZE_BYTES")
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .map_or_else(
            || text.required_space_unknown.to_string(),
            |value| format!("{} {}", text.required_space, format_size(value)),
        )
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

fn available_space_text(path: &Path, text: &InstallerStrings) -> String {
    let path = existing_path(path);
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0u64;
    // SAFETY: `wide` is NUL-terminated and remains live for the call; the
    // output pointer refers to a valid local `u64`.
    let result =
        unsafe { GetDiskFreeSpaceExW(PCWSTR(wide.as_ptr()), Some(&mut available), None, None) };
    match result {
        Ok(()) => format!("{}{}", text.available_space, format_size(available)),
        Err(_) => text.available_space_unknown.to_string(),
    }
}

fn raise_control(handle: &nwg::ControlHandle) {
    let Some(hwnd) = handle.hwnd() else {
        return;
    };
    // SAFETY: the control handle belongs to a live NWG control. The call only
    // changes z-order and explicitly leaves position, size and activation alone.
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
        // SAFETY: `wide` is a live, NUL-terminated absolute volume path.
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

fn validate_target(target: &Path, text: &InstallerStrings) -> Result<()> {
    if path_is_forbidden(target)? {
        bail!(text.unsupported_path);
    }
    if target.exists() && fs::read_dir(target)?.next().is_some() {
        bail!(text.occupied_directory);
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

struct LayeredSurface {
    memory_dc: HDC,
    bitmap: HBITMAP,
    previous_bitmap: HGDIOBJ,
    bits: *mut u8,
    width: u32,
    height: u32,
}

impl LayeredSurface {
    fn new(width: u32, height: u32) -> Result<Self> {
        // SAFETY: `BITMAPINFO` permits zero initialization before its header
        // fields are filled below.
        let mut info: BITMAPINFO = unsafe { std::mem::zeroed() };
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            // SAFETY: the remaining reserved and palette fields are defined to
            // be zero for this top-down 32-bit DIB.
            ..unsafe { std::mem::zeroed() }
        };
        let mut bits = std::ptr::null_mut();
        // SAFETY: a null reference DC requests a memory DC compatible with the
        // current display; the returned DC is owned by this surface.
        let memory_dc = unsafe { CreateCompatibleDC(std::ptr::null_mut()) };
        if memory_dc.is_null() {
            return Err(std::io::Error::last_os_error()).context("create animation memory DC");
        }
        // SAFETY: `info` is fully initialized for a top-down BGRA DIB and
        // `bits` is a valid out-pointer. The returned bitmap is owned here.
        let bitmap = unsafe {
            CreateDIBSection(
                memory_dc,
                &info,
                DIB_RGB_COLORS,
                &mut bits,
                std::ptr::null_mut(),
                0,
            )
        };
        if bitmap.is_null() || bits.is_null() {
            // SAFETY: only non-null resources created above are released, and
            // neither has been transferred to the surface yet.
            unsafe {
                if !bitmap.is_null() {
                    DeleteObject(bitmap.cast());
                }
                DeleteDC(memory_dc);
            }
            return Err(std::io::Error::last_os_error()).context("create animation DIB section");
        }
        // SAFETY: both GDI handles are valid and owned by this constructor.
        let previous_bitmap = unsafe { SelectObject(memory_dc, bitmap.cast()) };
        if previous_bitmap.is_null() || previous_bitmap == HGDI_ERROR {
            // SAFETY: selection failed, so the new bitmap is not owned by the
            // DC and both resources can be released directly.
            unsafe {
                DeleteObject(bitmap.cast());
                DeleteDC(memory_dc);
            }
            bail!("select animation DIB section into memory DC");
        }
        Ok(Self {
            memory_dc,
            bitmap,
            previous_bitmap,
            bits: bits.cast(),
            width,
            height,
        })
    }

    const fn matches(&self, width: u32, height: u32) -> bool {
        self.width == width && self.height == height
    }

    fn update(
        &mut self,
        hwnd: winapi::shared::windef::HWND,
        pixmap: &tiny_skia::Pixmap,
        mut destination: POINT,
    ) -> Result<()> {
        if !self.matches(pixmap.width(), pixmap.height()) {
            bail!("animation surface dimensions do not match the rendered frame");
        }
        // SAFETY: the DIB allocation is exactly `width * height * 4` bytes;
        // dimensions were checked above and `self.bits` stays valid for the
        // lifetime of the selected bitmap.
        let bgra = unsafe { std::slice::from_raw_parts_mut(self.bits, pixmap.data().len()) };
        for (rgba, target) in pixmap
            .data()
            .as_chunks::<4>()
            .0
            .iter()
            .zip(bgra.as_chunks_mut::<4>().0)
        {
            // tiny-skia stores premultiplied RGBA, which is exactly what
            // UpdateLayeredWindow's AC_SRC_ALPHA mode needs after the BGRA swap.
            target.copy_from_slice(&[rgba[2], rgba[1], rgba[0], rgba[3]]);
        }
        let mut source = POINT { x: 0, y: 0 };
        let mut size = SIZE {
            cx: self.width as i32,
            cy: self.height as i32,
        };
        let mut blend = BLENDFUNCTION {
            BlendOp: AC_SRC_OVER,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: AC_SRC_ALPHA,
        };
        // SAFETY: the window and memory DC are live, the source bitmap is
        // selected into the DC, and all geometry/blend pointers remain valid
        // for the duration of the call.
        let updated = unsafe {
            UpdateLayeredWindow(
                hwnd,
                std::ptr::null_mut(),
                &mut destination,
                &mut size,
                self.memory_dc,
                &mut source,
                0,
                &mut blend,
                ULW_ALPHA,
            )
        };
        if updated == 0 {
            return Err(std::io::Error::last_os_error()).context("update layered animation window");
        }
        Ok(())
    }
}

impl Drop for LayeredSurface {
    fn drop(&mut self) {
        // SAFETY: these GDI resources are exclusively owned by the surface.
        // Restoring the previous selection makes the bitmap safe to delete.
        unsafe {
            SelectObject(self.memory_dc, self.previous_bitmap);
            DeleteObject(self.bitmap.cast());
            DeleteDC(self.memory_dc);
        }
    }
}

fn set_animation_window_mode(wizard: &InstallWizard, active: bool) {
    let Some(hwnd) = wizard.window.handle.hwnd() else {
        return;
    };
    let mut current_rect = RECT {
        left: 0,
        top: 0,
        right: NORMAL_WINDOW_SIZE.0,
        bottom: NORMAL_WINDOW_SIZE.1,
    };
    // SAFETY: `hwnd` is the live installer window and `current_rect` is writable.
    unsafe {
        GetWindowRect(hwnd, &mut current_rect);
    }
    let current_center = (
        i32::midpoint(current_rect.left, current_rect.right),
        i32::midpoint(current_rect.top, current_rect.bottom),
    );
    let work_area = active.then(|| monitor_work_area(hwnd)).flatten();
    let (window_width, window_height) = if active {
        animation_window_size(hwnd, work_area.as_ref())
    } else {
        wizard.normal_window_size
    };
    let (window_left, window_top) = if active {
        work_area.as_ref().map_or(
            (
                current_center.0 - window_width / 2,
                current_center.1 - window_height / 2,
            ),
            |area| centered_window_origin(area, window_width, window_height),
        )
    } else {
        (
            current_center.0 - window_width / 2,
            current_center.1 - window_height / 2,
        )
    };
    let style = if active {
        (wizard.normal_window_style
            & !(WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_THICKFRAME))
            | WS_POPUP
            | WS_VISIBLE
    } else {
        wizard.normal_window_style
    };
    let ex_style = window_ex_style(wizard.normal_window_ex_style, active);
    // SAFETY: `hwnd` belongs to the live installer window. The saved styles
    // originated from this same window, and the computed dimensions are
    // positive and constrained to its monitor work area.
    unsafe {
        SetWindowLongW(hwnd, GWL_STYLE, style as i32);
        SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style as i32);
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
    if !active {
        wizard.animation_surface.borrow_mut().take();
        wizard.window.invalidate();
    }
}

struct InstallWizard {
    locale: BootstrapLocale,
    text: InstallerStrings,
    window: nwg::Window,
    intro_page: nwg::Frame,
    location_page: nwg::Frame,
    _intro_rule: nwg::Frame,
    _location_rule: nwg::Frame,
    footer_rule: nwg::Frame,
    icon_frame: nwg::ImageFrame,
    _intro_title: nwg::Label,
    _intro_body: nwg::Label,
    intro_version: nwg::Label,
    _location_title: nwg::Label,
    _location_body: nwg::Label,
    _parent_label: nwg::Label,
    parent_input: nwg::TextInput,
    _preview_label: nwg::Label,
    location_note: nwg::Label,
    browse_button: nwg::Button,
    back_button: nwg::Button,
    next_button: nwg::Button,
    cancel_button: nwg::Button,
    _window_icon: nwg::Icon,
    _icon_bitmap: nwg::Bitmap,
    _title_font: nwg::Font,
    _body_font: nwg::Font,
    _button_font: nwg::Font,
    animation_timer: nwg::AnimationTimer,
    animation_renderer: RefCell<AnimationRenderer>,
    animation_surface: RefCell<Option<LayeredSurface>>,
    selected_parent: RefCell<PathBuf>,
    result: RefCell<Option<PathBuf>>,
    install_target: RefCell<Option<PathBuf>>,
    install_receiver: RefCell<Option<Receiver<InstallEvent>>>,
    cancel_flag: RefCell<Option<Arc<AtomicBool>>>,
    completion_pending: Cell<bool>,
    completion_deadline: RefCell<Option<Instant>>,
    normal_window_style: u32,
    normal_window_ex_style: u32,
    normal_window_size: (i32, i32),
    page: Cell<WizardPage>,
    handler: RefCell<Option<nwg::EventHandler>>,
}

impl InstallWizard {
    fn set_animation_phase(&self, phase: InstallPhase) {
        self.animation_renderer.borrow_mut().set_phase(phase);
    }

    fn show_location_page(&self) {
        self.page.set(WizardPage::Location);
        self.intro_page.set_visible(false);
        self.intro_version.set_position(40, FOOTER_CONTROLS_Y + 2);
        self.intro_version.set_visible(true);
        self.location_page.set_visible(true);
        self.footer_rule.set_visible(true);
        self.back_button.set_enabled(true);
        self.back_button.set_visible(true);
        self.next_button.set_enabled(true);
        self.next_button.set_visible(true);
        self.next_button.set_text(self.text.install);
        self.cancel_button.set_text(self.text.cancel);
        self.cancel_button.set_enabled(true);
        self.cancel_button.set_visible(true);
        set_animation_window_mode(self, false);
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
        self.intro_version.set_position(40, FOOTER_CONTROLS_Y + 2);
        self.intro_version.set_visible(true);
        self.location_page.set_visible(false);
        self.footer_rule.set_visible(true);
        self.back_button.set_enabled(false);
        self.back_button.set_visible(true);
        self.next_button.set_enabled(true);
        self.next_button.set_visible(true);
        self.next_button.set_text(self.text.next);
        self.cancel_button.set_text(self.text.cancel);
        self.cancel_button.set_enabled(true);
        self.cancel_button.set_visible(true);
        set_animation_window_mode(self, false);
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

    fn render_animation_frame(&self) -> Result<()> {
        let hwnd = self
            .window
            .handle
            .hwnd()
            .context("installer window handle is unavailable")?;
        // SAFETY: a zeroed `RECT` is a valid output buffer for `GetWindowRect`.
        let mut rect: RECT = unsafe { std::mem::zeroed() };
        // SAFETY: `hwnd` is the live installer window and `rect` is writable.
        if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
            return Err(std::io::Error::last_os_error()).context("read animation window bounds");
        }
        let width = (rect.right - rect.left).max(1) as u32;
        let height = (rect.bottom - rect.top).max(1) as u32;
        // SAFETY: `hwnd` is the live installer window handle.
        let dpi_scale = unsafe { GetDpiForWindow(hwnd) }.max(96) as f32 / 96.0;
        let frame =
            self.animation_renderer
                .borrow()
                .render(width, height, dpi_scale, Instant::now())?;
        let mut surface = self.animation_surface.borrow_mut();
        if surface
            .as_ref()
            .is_none_or(|surface| !surface.matches(width, height))
        {
            *surface = Some(LayeredSurface::new(width, height)?);
        }
        surface
            .as_mut()
            .context("animation surface is unavailable")?
            .update(
                hwnd,
                &frame,
                POINT {
                    x: rect.left,
                    y: rect.top,
                },
            )
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
                        .completion_deadline(Instant::now());
                    *self.completion_deadline.borrow_mut() = Some(deadline);
                }
                InstallEvent::Failed(message) => {
                    self.return_to_location();
                    nwg::modal_error_message(&self.window, self.text.install_failed, &message);
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
        self.completion_pending.set(false);
        self.completion_deadline.borrow_mut().take();
        self.animation_renderer.borrow_mut().restart(Instant::now());
        self.set_animation_phase(InstallPhase::Preparing);
        let locale = self.locale;

        thread::Builder::new()
            .name("bz-games-velopack-install".to_string())
            .spawn(move || {
                if let Err(error) = install_payload(&target, locale, &sender, &cancel) {
                    let _ = sender.send(InstallEvent::Failed(format!("{error:#}")));
                }
            })
            .context("start background installer thread")?;

        self.page.set(WizardPage::Animation);
        self.intro_page.set_visible(false);
        self.intro_version.set_visible(false);
        self.location_page.set_visible(false);
        self.footer_rule.set_visible(false);
        self.back_button.set_visible(false);
        self.next_button.set_visible(false);
        self.cancel_button.set_visible(false);
        set_animation_window_mode(self, true);
        self.back_button.set_enabled(false);
        self.next_button.set_enabled(false);
        self.animation_timer.start();
        self.render_animation_frame()?;
        Ok(())
    }

    fn build(default_parent: &Path, locale: BootstrapLocale) -> Result<Rc<Self>> {
        let text = installer_strings(locale);
        nwg::init().map_err(|error| anyhow::anyhow!("initialize installer UI: {error:?}"))?;
        nwg::Font::set_global_family(FONT_FAMILY)
            .map_err(|error| anyhow::anyhow!("set installer UI font: {error:?}"))?;

        // Load the checked-in ICO's highest-resolution layer. Windows scales this
        // window icon to the title bar and taskbar size required by the current DPI.
        let mut window_icon = nwg::Icon::default();
        nwg::Icon::builder()
            .source_bin(Some(APP_ICON))
            .size(Some(WINDOW_ICON_SIZE))
            .strict(true)
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
        let display_icon_size = (96.0 * nwg::scale_factor()).round().max(1.0) as u32;
        let resized = decoder
            .resize_image(&frame, [display_icon_size, display_icon_size])
            .map_err(|error| anyhow::anyhow!("resize installer display icon: {error:?}"))?;
        let icon_bitmap = resized
            .as_bitmap()
            .map_err(|error| anyhow::anyhow!("create installer display bitmap: {error:?}"))?;
        let mut title_font = nwg::Font::default();
        nwg::Font::builder()
            .family(FONT_FAMILY)
            .size(TITLE_FONT_SIZE)
            .weight(TITLE_FONT_WEIGHT)
            .build(&mut title_font)
            .map_err(|error| anyhow::anyhow!("create installer title font: {error:?}"))?;
        let mut body_font = nwg::Font::default();
        nwg::Font::builder()
            .family(FONT_FAMILY)
            .size(BODY_FONT_SIZE)
            .build(&mut body_font)
            .map_err(|error| anyhow::anyhow!("create installer body font: {error:?}"))?;
        let mut button_font = nwg::Font::default();
        nwg::Font::builder()
            .family(FONT_FAMILY)
            .size(BUTTON_FONT_SIZE)
            .weight(BUTTON_FONT_WEIGHT)
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
            .title(text.window_title)
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
            .position((20, FOOTER_RULE_Y))
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
            .text(text.welcome_title)
            .font(Some(&title_font))
            .size((540, 52))
            .position((40, 28))
            .parent(&intro_page)
            .build(&mut intro_title)
            .map_err(|error| anyhow::anyhow!("create installer introduction title: {error:?}"))?;
        let mut intro_body = nwg::Label::default();
        nwg::Label::builder()
            .text(text.welcome_body)
            .font(Some(&body_font))
            .size((680, 200))
            .position((40, 130))
            .parent(&intro_page)
            .build(&mut intro_body)
            .map_err(|error| anyhow::anyhow!("create installer introduction text: {error:?}"))?;
        let mut intro_version = nwg::Label::default();
        nwg::Label::builder()
            .text(&format!("{}  {}", text.current_version, app_version()))
            .font(Some(&body_font))
            .size((340, 32))
            .position((40, FOOTER_CONTROLS_Y + 2))
            .flags(nwg::LabelFlags::VISIBLE | nwg::LabelFlags::DISABLED)
            .parent(&window)
            .build(&mut intro_version)
            .map_err(|error| anyhow::anyhow!("create installer version text: {error:?}"))?;

        let mut location_title = nwg::Label::default();
        nwg::Label::builder()
            .text(text.location_title)
            .font(Some(&title_font))
            .size((540, 52))
            .position((40, 28))
            .parent(&location_page)
            .build(&mut location_title)
            .map_err(|error| anyhow::anyhow!("create installer location title: {error:?}"))?;
        let mut location_body = nwg::Label::default();
        nwg::Label::builder()
            .text(text.location_body)
            .font(Some(&body_font))
            .size((680, 88))
            .position((40, 132))
            .parent(&location_page)
            .build(&mut location_body)
            .map_err(|error| anyhow::anyhow!("create installer location text: {error:?}"))?;
        let mut parent_label = nwg::Label::default();
        nwg::Label::builder()
            .text(text.target_folder)
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
            .text(text.change_location)
            .font(Some(&button_font))
            .size((145, 46))
            .position((545, 239))
            .parent(&location_page)
            .build(&mut browse_button)
            .map_err(|error| anyhow::anyhow!("create installer browse button: {error:?}"))?;
        let mut preview_label = nwg::Label::default();
        nwg::Label::builder()
            .text(&required_install_size_text(&text))
            .font(Some(&body_font))
            .size((640, 36))
            .position((64, 292))
            .parent(&location_page)
            .build(&mut preview_label)
            .map_err(|error| anyhow::anyhow!("create installer preview text: {error:?}"))?;
        let mut location_note = nwg::Label::default();
        nwg::Label::builder()
            .text(&available_space_text(default_parent, &text))
            .font(Some(&body_font))
            .size((640, 55))
            .position((64, 335))
            .flags(nwg::LabelFlags::VISIBLE | nwg::LabelFlags::DISABLED)
            .parent(&location_page)
            .build(&mut location_note)
            .map_err(|error| anyhow::anyhow!("create installer location note: {error:?}"))?;

        let mut back_button = nwg::Button::default();
        nwg::Button::builder()
            .text(text.back)
            .font(Some(&button_font))
            .size((96, 36))
            .position((430, FOOTER_CONTROLS_Y))
            .enabled(false)
            .parent(&window)
            .build(&mut back_button)
            .map_err(|error| anyhow::anyhow!("create installer back button: {error:?}"))?;
        let mut next_button = nwg::Button::default();
        nwg::Button::builder()
            .text(text.next)
            .font(Some(&button_font))
            .size((96, 36))
            .position((535, FOOTER_CONTROLS_Y))
            .focus(true)
            .parent(&window)
            .build(&mut next_button)
            .map_err(|error| anyhow::anyhow!("create installer next button: {error:?}"))?;
        let mut cancel_button = nwg::Button::default();
        nwg::Button::builder()
            .text(text.cancel)
            .font(Some(&button_font))
            .size((96, 36))
            .position((640, FOOTER_CONTROLS_Y))
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
        // SAFETY: the handle belongs to the newly constructed live window;
        // these calls only read its current style values.
        let (normal_window_style, normal_window_ex_style) = unsafe {
            (
                GetWindowLongW(window_handle, GWL_STYLE).cast_unsigned(),
                GetWindowLongW(window_handle, GWL_EXSTYLE).cast_unsigned(),
            )
        };
        // SAFETY: a zeroed `RECT` is a valid output buffer for `GetWindowRect`.
        let mut normal_window_rect: RECT = unsafe { std::mem::zeroed() };
        // SAFETY: `window_handle` is live and `normal_window_rect` is writable.
        if unsafe { GetWindowRect(window_handle, &mut normal_window_rect) } == 0 {
            return Err(std::io::Error::last_os_error())
                .context("read initial installer window bounds");
        }
        let normal_window_size = (
            normal_window_rect.right - normal_window_rect.left,
            normal_window_rect.bottom - normal_window_rect.top,
        );
        location_page.set_visible(false);
        let wizard = Rc::new(Self {
            locale,
            text,
            window,
            intro_page,
            location_page,
            _intro_rule: intro_rule,
            _location_rule: location_rule,
            footer_rule,
            icon_frame,
            _intro_title: intro_title,
            _intro_body: intro_body,
            intro_version,
            _location_title: location_title,
            _location_body: location_body,
            _parent_label: parent_label,
            parent_input,
            _preview_label: preview_label,
            location_note,
            browse_button,
            back_button,
            next_button,
            cancel_button,
            _window_icon: window_icon,
            _icon_bitmap: icon_bitmap,
            _title_font: title_font,
            _body_font: body_font,
            _button_font: button_font,
            animation_timer,
            animation_renderer: RefCell::new(animation_renderer),
            animation_surface: RefCell::new(None),
            selected_parent: RefCell::new(default_parent.to_path_buf()),
            result: RefCell::new(None),
            install_target: RefCell::new(None),
            install_receiver: RefCell::new(None),
            cancel_flag: RefCell::new(None),
            completion_pending: Cell::new(false),
            completion_deadline: RefCell::new(None),
            normal_window_style,
            normal_window_ex_style,
            normal_window_size,
            page: Cell::new(WizardPage::Intro),
            handler: RefCell::new(None),
        });
        wizard.show_intro_page();

        let events_wizard = wizard.clone();
        let handler = nwg::full_bind_event_handler(
            &wizard.window.handle,
            move |event, event_data, handle| match event {
                nwg::Event::OnTimerTick if handle == events_wizard.animation_timer.handle => {
                    events_wizard.poll_install_events();
                    if events_wizard.page.get() == WizardPage::Animation {
                        let _ = events_wizard.render_animation_frame();
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
                    } else if !events_wizard.completion_pending.get() {
                        events_wizard.request_cancel();
                    }
                }
                nwg::Event::OnButtonClick if handle == events_wizard.browse_button.handle => {
                    if events_wizard.page.get() != WizardPage::Location {
                        return;
                    }
                    let current_parent = events_wizard.selected_parent.borrow().clone();
                    let mut dialog = nwg::FileDialog::default();
                    let dialog_result = nwg::FileDialog::builder()
                        .title(events_wizard.text.choose_parent)
                        .action(nwg::FileDialogAction::OpenDirectory)
                        .default_folder(current_parent.to_string_lossy())
                        .build(&mut dialog);
                    match dialog_result {
                        Err(error) => {
                            nwg::modal_error_message(
                                &events_wizard.window,
                                events_wizard.text.picker_failed,
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
                                    events_wizard.location_note.set_text(&available_space_text(
                                        &preview,
                                        &events_wizard.text,
                                    ));
                                    *events_wizard.selected_parent.borrow_mut() = selected;
                                }
                                Err(error) => {
                                    nwg::modal_error_message(
                                        &events_wizard.window,
                                        events_wizard.text.folder_failed,
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
                        match validate_target(&target, &events_wizard.text) {
                            Ok(()) => {
                                if let Err(error) = events_wizard.start_install(target) {
                                    events_wizard.return_to_location();
                                    nwg::modal_error_message(
                                        &events_wizard.window,
                                        events_wizard.text.start_failed,
                                        &format!("{error:#}"),
                                    );
                                }
                            }
                            Err(error) => {
                                nwg::modal_error_message(
                                    &events_wizard.window,
                                    events_wizard.text.install_failed,
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

fn show_install_wizard(default_parent: &Path, locale: BootstrapLocale) -> Result<Option<PathBuf>> {
    let wizard = InstallWizard::build(default_parent, locale)?;
    nwg::dispatch_thread_events();
    if let Some(handler) = wizard.handler.borrow_mut().take() {
        nwg::unbind_event_handler(&handler);
    }
    let result = wizard.result.borrow_mut().take();
    Ok(result)
}

fn install_payload(
    target: &Path,
    locale: BootstrapLocale,
    sender: &Sender<InstallEvent>,
    cancel: &AtomicBool,
) -> Result<()> {
    let temporary = std::env::temp_dir().join(format!("bz-games-installer-{}", Uuid::new_v4()));
    let operation = (|| {
        if cancel.load(Ordering::Acquire) {
            let _ = sender.send(InstallEvent::Canceled);
            return Ok(());
        }

        fs::create_dir_all(&temporary).context("create temporary installer directory")?;
        let setup = temporary.join("Setup.exe");
        let log_path = temporary.join("velopack-install.log");
        fs::write(&setup, VELOPACK_SETUP).context("write temporary Velopack installer")?;
        if cancel.load(Ordering::Acquire) {
            let _ = fs::remove_dir_all(target);
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
                let _ = fs::remove_dir_all(target);
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
            let _ = fs::remove_dir_all(target);
            let _ = sender.send(InstallEvent::Canceled);
            return Ok(());
        }

        let _ = sender.send(InstallEvent::Phase(InstallPhase::Finalizing));
        fs::write(target.join("BZ-Games.exe"), ROOT_LAUNCHER)
            .context("write BZ-Games root launcher")?;
        fs::write(target.join("BZ-Games-Uninstall.exe"), ROOT_UNINSTALLER)
            .context("write BZ-Games root uninstaller")?;
        fs::write(target.join(".bz-games-root"), b"bz-games-root-v1\n")?;
        write_initial_language(target, locale)?;
        fs::create_dir_all(target.join("games"))?;
        fs::create_dir_all(target.join("db"))?;
        register_shell(target)?;
        let _ = sender.send(InstallEvent::Completed(target.to_path_buf()));
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
        let _ = fs::remove_dir_all(target);
    }
    operation
}

fn write_initial_language(target: &Path, locale: BootstrapLocale) -> Result<()> {
    fs::write(
        target.join(".initial-language"),
        format!("{}\n", locale.code()),
    )
    .context("write initial client language")
}

fn install_payload_sync(target: &Path, locale: BootstrapLocale) -> Result<()> {
    let (sender, _receiver) = mpsc::channel();
    install_payload(target, locale, &sender, &AtomicBool::new(false))
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

fn run(locale: BootstrapLocale) -> Result<()> {
    let text = installer_strings(locale);
    if VELOPACK_SETUP.is_empty() || ROOT_LAUNCHER.is_empty() || ROOT_UNINSTALLER.is_empty() {
        bail!("installer payload was not embedded by the release build");
    }

    if let Some(target) = cli_install_target()? {
        validate_target(&target, &text)?;
        install_payload_sync(&target, locale)?;
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
    let Some(target) = show_install_wizard(default_parent, locale)? else {
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
    let locale = detect_user_locale();
    let text = installer_strings(locale);
    if let Err(error) = run(locale) {
        MessageDialog::new()
            .set_level(MessageLevel::Error)
            .set_title(text.window_title)
            .set_description(format!("{}\n{error:#}", text.fatal_prefix))
            .show();
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        centered_window_origin, installation_root, window_ex_style, write_initial_language,
        BootstrapLocale,
    };
    use std::{fs, path::Path};
    use uuid::Uuid;
    use winapi::shared::windef::RECT;
    use winapi::um::winuser::{
        WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    #[test]
    fn animation_window_style_is_click_through_and_non_activating() {
        let normal_style = 0x0004_0000;
        let animation_style = window_ex_style(normal_style, true);

        assert_eq!(animation_style & normal_style, normal_style);
        assert_ne!(animation_style & WS_EX_LAYERED, 0);
        assert_ne!(animation_style & WS_EX_TOOLWINDOW, 0);
        assert_ne!(animation_style & WS_EX_NOACTIVATE, 0);
        assert_ne!(animation_style & WS_EX_TRANSPARENT, 0);
        assert_eq!(window_ex_style(normal_style, false), normal_style);
    }

    #[test]
    fn animation_window_centers_in_monitor_work_area() {
        let primary = RECT {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1040,
        };
        let secondary = RECT {
            left: -1920,
            top: 0,
            right: 0,
            bottom: 1040,
        };

        assert_eq!(centered_window_origin(&primary, 800, 800), (560, 120));
        assert_eq!(centered_window_origin(&secondary, 800, 800), (-1360, 120));
    }

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

    #[test]
    fn initial_language_marker_uses_client_locale_code() {
        let target = std::env::temp_dir().join(format!(
            "bz-games-installer-language-test-{}",
            Uuid::new_v4()
        ));
        fs::create_dir_all(&target).unwrap();
        write_initial_language(&target, BootstrapLocale::ZhTw).unwrap();
        assert_eq!(
            fs::read_to_string(target.join(".initial-language")).unwrap(),
            "zh-TW\n"
        );
        fs::remove_dir_all(target).unwrap();
    }
}
