#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use anyhow::{bail, Context, Result};
use chrono::{DateTime, Utc};
use native_windows_gui as nwg;
use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::os::windows::{ffi::OsStrExt, fs::MetadataExt, process::CommandExt};
use std::rc::Rc;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender},
    },
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;
use windows::{
    core::{HRESULT, PCWSTR},
    Win32::{
        Foundation::{CloseHandle, ERROR_INVALID_PARAMETER, WAIT_OBJECT_0, WAIT_TIMEOUT},
        Globalization::GetUserDefaultLocaleName,
        Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH},
        System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
    },
};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const PLAN_FORMAT: &str = "bz-games-uninstall-plan";
const PLAN_VERSION: u32 = 1;
const JOURNAL_FORMAT: &str = "bz-games-uninstall-journal";
const ROOT_MARKER: &str = "bz-games-root-v1";
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const WAIT_TIMEOUT_MS: u32 = 60_000;
const VELOPACK_SELF_DELETE_TIMEOUT: Duration = Duration::from_secs(15);
const MINIMUM_PROGRESS_WINDOW_DURATION: Duration = Duration::from_millis(900);
const FINAL_PROGRESS_PAINT_DURATION: Duration = Duration::from_millis(250);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
static ERROR_REPORTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum UninstallSource {
    InApp,
    System,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UninstallPlan {
    format: String,
    format_version: u32,
    operation_id: Uuid,
    source: UninstallSource,
    locale: String,
    install_root: PathBuf,
    application_pid: u32,
    delete_games: bool,
    delete_user_data: bool,
    game_library_roots: Vec<PathBuf>,
    created_at: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
enum UninstallPhase {
    Prepared,
    WaitingForProcesses,
    PreflightComplete,
    RecoveryRegistered,
    LauncherQuarantined,
    RuntimeRemoved,
    ShellIntegrationRemoved,
    OptionalDataCleanup,
    RootBinariesRemoved,
    Finalized,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WorkerOutcome {
    Completed,
    CompletedWithIssues,
    Canceled,
}

enum ProgressEvent {
    Phase(UninstallPhase),
    Finished(Result<WorkerOutcome, String>),
}

fn phase_progress(phase: UninstallPhase) -> u32 {
    match phase {
        UninstallPhase::Prepared => 5,
        UninstallPhase::WaitingForProcesses => 15,
        UninstallPhase::PreflightComplete => 25,
        UninstallPhase::RecoveryRegistered => 35,
        UninstallPhase::LauncherQuarantined => 45,
        UninstallPhase::RuntimeRemoved => 65,
        UninstallPhase::ShellIntegrationRemoved => 75,
        UninstallPhase::OptionalDataCleanup => 85,
        UninstallPhase::RootBinariesRemoved => 95,
        UninstallPhase::Finalized => 100,
    }
}

fn phase_text(locale: &str, phase: UninstallPhase) -> &'static str {
    match locale {
        "zh-CN" => match phase {
            UninstallPhase::Prepared => "正在准备卸载…",
            UninstallPhase::WaitingForProcesses => "正在等待 BZ-Games 退出…",
            UninstallPhase::PreflightComplete => "安全检查已完成…",
            UninstallPhase::RecoveryRegistered => "正在建立恢复入口…",
            UninstallPhase::LauncherQuarantined => "正在隔离客户端入口…",
            UninstallPhase::RuntimeRemoved => "客户端运行文件已删除…",
            UninstallPhase::ShellIntegrationRemoved => "正在清理系统集成…",
            UninstallPhase::OptionalDataCleanup => "正在清理所选数据…",
            UninstallPhase::RootBinariesRemoved => "正在完成客户端清理…",
            UninstallPhase::Finalized => "卸载完成。",
        },
        "zh-TW" => match phase {
            UninstallPhase::Prepared => "正在準備解除安裝…",
            UninstallPhase::WaitingForProcesses => "正在等待 BZ-Games 結束…",
            UninstallPhase::PreflightComplete => "安全檢查已完成…",
            UninstallPhase::RecoveryRegistered => "正在建立復原入口…",
            UninstallPhase::LauncherQuarantined => "正在隔離用戶端入口…",
            UninstallPhase::RuntimeRemoved => "用戶端執行檔已刪除…",
            UninstallPhase::ShellIntegrationRemoved => "正在清理系統整合…",
            UninstallPhase::OptionalDataCleanup => "正在清理所選資料…",
            UninstallPhase::RootBinariesRemoved => "正在完成用戶端清理…",
            UninstallPhase::Finalized => "解除安裝完成。",
        },
        "ja-JP" => match phase {
            UninstallPhase::Prepared => "アンインストールを準備しています…",
            UninstallPhase::WaitingForProcesses => "BZ-Games の終了を待っています…",
            UninstallPhase::PreflightComplete => "安全確認が完了しました…",
            UninstallPhase::RecoveryRegistered => "回復エントリを作成しています…",
            UninstallPhase::LauncherQuarantined => "クライアント入口を分離しています…",
            UninstallPhase::RuntimeRemoved => "クライアント実行ファイルを削除しました…",
            UninstallPhase::ShellIntegrationRemoved => "システム統合を削除しています…",
            UninstallPhase::OptionalDataCleanup => "選択したデータを削除しています…",
            UninstallPhase::RootBinariesRemoved => "クライアントの削除を完了しています…",
            UninstallPhase::Finalized => "アンインストールが完了しました。",
        },
        "de-DE" => match phase {
            UninstallPhase::Prepared => "Deinstallation wird vorbereitet…",
            UninstallPhase::WaitingForProcesses => "Warten auf das Beenden von BZ-Games…",
            UninstallPhase::PreflightComplete => "Sicherheitsprüfung abgeschlossen…",
            UninstallPhase::RecoveryRegistered => "Wiederherstellungseintrag wird erstellt…",
            UninstallPhase::LauncherQuarantined => "Client-Einstieg wird isoliert…",
            UninstallPhase::RuntimeRemoved => "Client-Laufzeitdateien wurden entfernt…",
            UninstallPhase::ShellIntegrationRemoved => "Systemintegration wird entfernt…",
            UninstallPhase::OptionalDataCleanup => "Ausgewählte Daten werden bereinigt…",
            UninstallPhase::RootBinariesRemoved => "Client-Bereinigung wird abgeschlossen…",
            UninstallPhase::Finalized => "Deinstallation abgeschlossen.",
        },
        _ => match phase {
            UninstallPhase::Prepared => "Preparing to uninstall…",
            UninstallPhase::WaitingForProcesses => "Waiting for BZ-Games to exit…",
            UninstallPhase::PreflightComplete => "Safety checks completed…",
            UninstallPhase::RecoveryRegistered => "Registering recovery entry…",
            UninstallPhase::LauncherQuarantined => "Isolating the client launcher…",
            UninstallPhase::RuntimeRemoved => "Client runtime files removed…",
            UninstallPhase::ShellIntegrationRemoved => "Removing system integration…",
            UninstallPhase::OptionalDataCleanup => "Cleaning selected data…",
            UninstallPhase::RootBinariesRemoved => "Finishing client cleanup…",
            UninstallPhase::Finalized => "Uninstallation completed.",
        },
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CleanupIssue {
    operation: String,
    path: PathBuf,
    error: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UninstallJournal {
    format: String,
    format_version: u32,
    plan: UninstallPlan,
    phase: UninstallPhase,
    quarantined_launcher: Option<PathBuf>,
    issues: Vec<CleanupIssue>,
    updated_at: String,
}

struct Strings {
    title: &'static str,
    confirm: &'static str,
    running: &'static str,
    failed: &'static str,
    partial: &'static str,
    progress_title: &'static str,
    success: &'static str,
}

fn strings(locale: &str) -> Strings {
    match locale {
        "zh-CN" => Strings {
            title: "BZ-Games 卸载",
            confirm: "将仅卸载 BZ-Games 客户端。游戏库、配置和数据库都会保留。是否继续？",
            running: "BZ-Games 仍在运行。请关闭客户端后重试。",
            failed: "卸载未完成。为保护数据，后续操作已停止。",
            partial: "客户端已卸载，但部分清理操作未完成。",
            progress_title: "正在卸载 BZ-Games",
            success: "BZ-Games 已成功卸载。",
        },
        "zh-TW" => Strings {
            title: "BZ-Games 解除安裝",
            confirm: "只會解除安裝 BZ-Games 用戶端。遊戲庫、設定和資料庫都會保留。是否繼續？",
            running: "BZ-Games 仍在執行。請關閉用戶端後重試。",
            failed: "解除安裝尚未完成。為保護資料，後續操作已停止。",
            partial: "用戶端已解除安裝，但部分清理操作未完成。",
            progress_title: "正在解除安裝 BZ-Games",
            success: "BZ-Games 已成功解除安裝。",
        },
        "ja-JP" => Strings {
            title: "BZ-Games アンインストール",
            confirm: "BZ-Games クライアントのみ削除します。ゲームライブラリ、設定、データベースは保持されます。続行しますか？",
            running: "BZ-Games が実行中です。終了してから再試行してください。",
            failed: "アンインストールは完了していません。データ保護のため処理を停止しました。",
            partial: "クライアントは削除されましたが、一部のクリーンアップに失敗しました。",
            progress_title: "BZ-Games をアンインストールしています",
            success: "BZ-Games のアンインストールが完了しました。",
        },
        "de-DE" => Strings {
            title: "BZ-Games deinstallieren",
            confirm: "Nur der BZ-Games-Client wird entfernt. Spielebibliotheken, Einstellungen und Datenbank bleiben erhalten. Fortfahren?",
            running: "BZ-Games wird noch ausgeführt. Schließe den Client und versuche es erneut.",
            failed: "Die Deinstallation wurde zum Schutz deiner Daten angehalten.",
            partial: "Der Client wurde entfernt, aber einige Bereinigungen sind fehlgeschlagen.",
            progress_title: "BZ-Games wird deinstalliert",
            success: "BZ-Games wurde erfolgreich deinstalliert.",
        },
        _ => Strings {
            title: "BZ-Games Uninstall",
            confirm: "Only the BZ-Games client will be removed. Game libraries, settings, and the database will be preserved. Continue?",
            running: "BZ-Games is still running. Close the client and try again.",
            failed: "Uninstallation did not complete. Further work was stopped to protect your data.",
            partial: "The client was removed, but some cleanup operations did not complete.",
            progress_title: "Uninstalling BZ-Games",
            success: "BZ-Games was uninstalled successfully.",
        },
    }
}

fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&temporary, serde_json::to_vec_pretty(value)?)?;
    let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(target.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )?;
    }
    Ok(())
}

fn argument_value<'a>(arguments: &'a [String], name: &str) -> Option<&'a str> {
    arguments
        .windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].as_str())
}

fn local_app_data() -> Result<PathBuf> {
    dirs::data_local_dir().context("local application data directory is unavailable")
}

fn work_root() -> Result<PathBuf> {
    Ok(local_app_data()?.join("BZ-Games").join("UninstallWork"))
}

fn report_root() -> Result<PathBuf> {
    Ok(local_app_data()?.join("BZ-Games").join("UninstallReports"))
}

fn system_locale() -> String {
    let mut buffer = [0u16; 85];
    let length = unsafe { GetUserDefaultLocaleName(&mut buffer) };
    let raw = if length > 1 {
        String::from_utf16_lossy(&buffer[..length as usize - 1]).to_lowercase()
    } else {
        String::new()
    };
    if raw.starts_with("zh-tw") || raw.starts_with("zh-hk") || raw.starts_with("zh-mo") {
        "zh-TW".to_string()
    } else if raw.starts_with("zh") {
        "zh-CN".to_string()
    } else if raw.starts_with("ja") {
        "ja-JP".to_string()
    } else if raw.starts_with("de") {
        "de-DE".to_string()
    } else {
        "en-US".to_string()
    }
}

fn validate_plain_file(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("read file metadata: {}", path.display()))?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        bail!("expected a regular file: {}", path.display());
    }
    Ok(())
}

fn validate_plain_directory(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("read directory metadata: {}", path.display()))?;
    if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        bail!("expected a regular directory: {}", path.display());
    }
    Ok(())
}

fn normalized_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn path_contains(parent: &Path, child: &Path) -> bool {
    let parent = normalized_path(parent);
    let child = normalized_path(child);
    child == parent || child.starts_with(&format!("{parent}\\"))
}

fn ensure_no_reparse_ancestor(path: &Path) -> Result<()> {
    let mut cursor = Some(path);
    while let Some(current) = cursor {
        if current.exists()
            && fs::symlink_metadata(current)?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        {
            bail!("path is below a reparse point: {}", path.display());
        }
        cursor = current.parent();
    }
    Ok(())
}

fn load_plan_internal(path: &Path, allow_expired: bool) -> Result<UninstallPlan> {
    validate_plain_file(path)?;
    let plan: UninstallPlan = serde_json::from_slice(&fs::read(path)?)?;
    if plan.format != PLAN_FORMAT || plan.format_version != PLAN_VERSION {
        bail!("unsupported uninstall plan");
    }
    if !plan.install_root.is_absolute() || plan.application_pid == 0 {
        bail!("invalid uninstall plan root or process id");
    }
    if !matches!(
        plan.locale.as_str(),
        "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "de-DE"
    ) {
        bail!("unsupported uninstall locale");
    }
    let created = DateTime::parse_from_rfc3339(&plan.created_at)
        .context("invalid uninstall plan creation time")?;
    let age = Utc::now().signed_duration_since(created.with_timezone(&Utc));
    if !allow_expired && (age.num_seconds() < -300 || age.num_minutes() > 30) {
        bail!("uninstall plan expired");
    }
    if plan.source == UninstallSource::System
        && (plan.delete_games || plan.delete_user_data || !plan.game_library_roots.is_empty())
    {
        bail!("system uninstall must preserve all user data");
    }
    Ok(plan)
}

#[cfg(test)]
fn load_plan(path: &Path) -> Result<UninstallPlan> {
    load_plan_internal(path, false)
}

fn validate_installation(plan: &UninstallPlan) -> Result<()> {
    validate_install_root(plan)?;
    let marker = plan.install_root.join(".bz-games-root");
    validate_plain_file(&marker)?;
    if fs::read_to_string(&marker)?.trim() != ROOT_MARKER {
        bail!("invalid BZ-Games installation marker");
    }
    validate_plain_file(&plan.install_root.join("BZ-Games.exe"))?;
    validate_plain_file(&plan.install_root.join("BZ-Games-Uninstall.exe"))?;
    validate_plain_file(&plan.install_root.join(".runtime").join("Update.exe"))?;
    Ok(())
}

fn validate_install_root(plan: &UninstallPlan) -> Result<()> {
    ensure_no_reparse_ancestor(&plan.install_root)?;
    validate_plain_directory(&plan.install_root)?;
    // Windows canonicalization commonly adds a `\\?\` prefix and expands
    // 8.3 path segments. Those are alternate spellings of the same directory,
    // not unsafe roots. Successful canonicalization plus the explicit
    // reparse-point checks above is the security boundary we need here.
    let _ = fs::canonicalize(&plan.install_root)?;
    Ok(())
}

fn validate_game_library(root: &Path, candidate: &Path) -> Result<Option<PathBuf>> {
    if !candidate.is_absolute() {
        bail!("game library is not absolute: {}", candidate.display());
    }
    if !candidate.exists() {
        return Ok(None);
    }
    ensure_no_reparse_ancestor(candidate)?;
    let resolved = fs::canonicalize(candidate)?;
    validate_plain_directory(&resolved)?;
    if resolved.parent().is_none() {
        bail!("refusing to delete a volume root");
    }
    let install_root = fs::canonicalize(root)?;
    if path_contains(&resolved, &install_root) {
        bail!("game library contains the installation root");
    }
    for protected in [
        dirs::home_dir(),
        dirs::data_dir(),
        dirs::data_local_dir(),
        Some(std::env::temp_dir()),
    ]
    .into_iter()
    .flatten()
    {
        if let Ok(protected) = fs::canonicalize(protected) {
            if path_contains(&resolved, &protected) {
                bail!("game library contains a protected directory");
            }
        }
    }
    Ok(Some(resolved))
}

fn validated_game_libraries(plan: &UninstallPlan) -> Result<Vec<PathBuf>> {
    let mut result = Vec::<PathBuf>::new();
    for candidate in &plan.game_library_roots {
        let Some(resolved) = validate_game_library(&plan.install_root, candidate)? else {
            continue;
        };
        if result
            .iter()
            .any(|existing| path_contains(existing, &resolved))
        {
            continue;
        }
        result.retain(|existing| !path_contains(&resolved, existing));
        result.push(resolved);
    }
    Ok(result)
}

fn write_journal(
    path: &Path,
    journal: &mut UninstallJournal,
    phase: UninstallPhase,
    progress: Option<&Sender<ProgressEvent>>,
) -> Result<()> {
    journal.phase = phase;
    journal.updated_at = Utc::now().to_rfc3339();
    atomic_json(path, journal)?;
    if let Some(progress) = progress {
        let _ = progress.send(ProgressEvent::Phase(phase));
    }
    Ok(())
}

fn wait_for_process_exit(process_id: u32, cancel_path: Option<&Path>) -> Result<bool> {
    let process = match unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, process_id) } {
        Ok(process) => process,
        Err(error) if error.code().0 == HRESULT::from_win32(ERROR_INVALID_PARAMETER.0).0 => {
            return Ok(true);
        }
        Err(error) => return Err(error).context("open process before uninstall"),
    };
    let deadline = Instant::now() + Duration::from_millis(WAIT_TIMEOUT_MS.into());
    loop {
        if cancel_path.is_some_and(Path::exists) {
            unsafe { CloseHandle(process) }?;
            return Ok(false);
        }
        let wait_result = unsafe { WaitForSingleObject(process, 250) };
        if wait_result == WAIT_OBJECT_0 {
            unsafe { CloseHandle(process) }?;
            return Ok(true);
        }
        if wait_result != WAIT_TIMEOUT {
            unsafe { CloseHandle(process) }?;
            bail!("failed while waiting for BZ-Games to exit");
        }
        if Instant::now() >= deadline {
            unsafe { CloseHandle(process) }?;
            bail!("timed out waiting for BZ-Games to exit");
        }
    }
}

fn bz_games_process_running() -> bool {
    Command::new("tasklist.exe")
        .args(["/FI", "IMAGENAME eq BZ-Games.exe", "/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
        .is_some_and(|output| {
            String::from_utf8_lossy(&output.stdout)
                .to_lowercase()
                .contains("bz-games.exe")
        })
}

fn wait_for_application_tree() -> Result<()> {
    let deadline = Instant::now() + Duration::from_secs(60);
    while bz_games_process_running() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(250));
    }
    if bz_games_process_running() {
        bail!("BZ-Games processes are still running");
    }
    Ok(())
}

fn uninstall_key() -> Result<winreg::RegKey> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    Ok(hkcu
        .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\com.bzgames.desktop")?
        .0)
}

fn set_uninstall_command(command: &Path, arguments: &str) -> Result<()> {
    uninstall_key()?.set_value(
        "UninstallString",
        &format!("\"{}\" {arguments}", command.display()),
    )?;
    Ok(())
}

fn retry_rename(source: &Path, target: &Path) -> Result<()> {
    let mut last = None;
    for attempt in 0..12 {
        match fs::rename(source, target) {
            Ok(()) => return Ok(()),
            Err(error) => last = Some(error),
        }
        thread::sleep(Duration::from_millis(100 + attempt * 100));
    }
    Err(last
        .context("rename failed without an operating-system error")?
        .into())
}

fn retry_remove_file(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let mut last = None;
    for attempt in 0..12 {
        match fs::remove_file(path) {
            Ok(()) if !path.exists() => return Ok(()),
            Ok(()) => {}
            Err(error) => last = Some(error),
        }
        thread::sleep(Duration::from_millis(100 + attempt * 100));
    }
    Err(last
        .context("delete failed without an operating-system error")?
        .into())
}

fn retry_remove_plain_file(path: &Path) -> Result<()> {
    if path.exists() {
        validate_plain_file(path)?;
    }
    retry_remove_file(path)
}

fn retry_remove_runtime_directory(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    validate_plain_directory(path)?;
    let deadline = Instant::now() + VELOPACK_SELF_DELETE_TIMEOUT;
    let mut last_error = None;
    while Instant::now() < deadline {
        match fs::remove_dir_all(path) {
            Ok(()) if !path.exists() => return Ok(()),
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => last_error = Some(error),
        }
        thread::sleep(Duration::from_millis(100));
    }
    if !path.exists() {
        return Ok(());
    }
    Err(last_error
        .context("runtime directory remained without an operating-system error")?
        .into())
}

fn run_velopack(root: &Path) -> Result<()> {
    let runtime = root.join(".runtime");
    let updater = runtime.join("Update.exe");
    if !updater.exists() {
        // A previous one-way uninstall attempt may already have removed Update.exe while a
        // process still had an empty runtime directory open.  That residue must not prevent
        // the remaining uninstall stages from continuing.
        let _ = retry_remove_runtime_directory(&runtime);
        return Ok(());
    }
    validate_plain_file(&updater)?;
    let status = Command::new(&updater)
        .args(["uninstall", "--silent"])
        .current_dir(root)
        .status()
        .context("start Velopack uninstall")?;
    if !status.success() {
        bail!("Velopack uninstall failed with {status}");
    }
    // Velopack can leave its runtime directory temporarily locked by its own delayed cleanup
    // process.  Once Velopack has reported success, an empty/partial .runtime directory is not
    // a client capable of running and is safe to leave behind.  Continue the one-way uninstall
    // instead of turning this harmless residue into a fatal error.
    let _ = retry_remove_runtime_directory(&runtime);
    Ok(())
}

fn push_issue(
    issues: &mut Vec<CleanupIssue>,
    operation: &str,
    path: PathBuf,
    error: impl ToString,
) {
    issues.push(CleanupIssue {
        operation: operation.to_string(),
        path,
        error: error.to_string(),
    });
}

fn remove_shell_integration(root: &Path, issues: &mut Vec<CleanupIssue>) {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Err(error) = hkcu.delete_subkey_all(r"Software\Classes\bzgames") {
        if error.kind() != std::io::ErrorKind::NotFound {
            push_issue(issues, "remove_protocol", root.to_path_buf(), error);
        }
    }
    match hkcu.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        winreg::enums::KEY_READ | winreg::enums::KEY_WRITE,
    ) {
        Ok(run) => {
            if let Err(error) = run.delete_value("BZ-Games") {
                if error.kind() != std::io::ErrorKind::NotFound {
                    push_issue(
                        issues,
                        "remove_startup_entry",
                        PathBuf::from("BZ-Games"),
                        error,
                    );
                }
            }
        }
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => push_issue(
            issues,
            "open_startup_entries",
            PathBuf::from(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"),
            error,
        ),
        Err(_) => {}
    }
    for shortcut in [
        dirs::desktop_dir().map(|dir| dir.join("BZ-Games.lnk")),
        dirs::data_dir().map(|dir| dir.join(r"Microsoft\Windows\Start Menu\Programs\BZ-Games.lnk")),
    ]
    .into_iter()
    .flatten()
    {
        if shortcut.exists() {
            if let Err(error) = retry_remove_plain_file(&shortcut) {
                push_issue(issues, "remove_shortcut", shortcut, error);
            }
        }
    }
}

fn remove_directory(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    validate_plain_directory(path)?;
    fs::remove_dir_all(path)?;
    if path.exists() {
        bail!("directory still exists after deletion");
    }
    Ok(())
}

fn cleanup_optional_data(plan: &UninstallPlan, issues: &mut Vec<CleanupIssue>) {
    if plan.delete_games {
        match validated_game_libraries(plan) {
            Ok(libraries) => {
                for library in libraries {
                    if let Err(error) = remove_directory(&library) {
                        push_issue(issues, "remove_game_library", library, error);
                    }
                }
            }
            Err(error) => push_issue(
                issues,
                "validate_game_libraries",
                plan.install_root.clone(),
                error,
            ),
        }
    }
    if plan.delete_user_data {
        let config = plan.install_root.join("config.json");
        if let Err(error) = retry_remove_plain_file(&config) {
            push_issue(issues, "remove_configuration", config, error);
        }
        let database = plan.install_root.join("db");
        if let Err(error) = remove_directory(&database) {
            push_issue(issues, "remove_database", database, error);
        }
        if let Ok(entries) = fs::read_dir(&plan.install_root) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name == ".backup-rollback" || name.starts_with(".backup-work-") {
                    let path = entry.path();
                    if let Err(error) = remove_directory(&path) {
                        push_issue(issues, "remove_backup_work", path, error);
                    }
                }
            }
        }
    }
}

fn write_report(journal: &UninstallJournal, error: Option<&anyhow::Error>) -> Result<PathBuf> {
    let root = report_root()?;
    fs::create_dir_all(&root)?;
    let path = root.join(format!(
        "uninstall-{}-{}.log",
        Utc::now().format("%Y%m%d-%H%M%S"),
        journal.plan.operation_id
    ));
    let mut body = format!(
        "operation={}\nphase={:?}\nsource={:?}\nroot={}\n",
        journal.plan.operation_id,
        journal.phase,
        journal.plan.source,
        journal.plan.install_root.display()
    );
    if let Some(error) = error {
        body.push_str(&format!("error={error:#}\n"));
    }
    for issue in &journal.issues {
        body.push_str(&format!(
            "issue={} | {} | {}\n",
            issue.operation,
            issue.path.display(),
            issue.error
        ));
    }
    fs::write(&path, body)?;
    Ok(path)
}

fn spawn_self_cleanup(work_dir: &Path) -> Result<()> {
    let script = work_dir.join("cleanup.cmd");
    fs::write(
        &script,
        "@echo off\r\nsetlocal\r\nfor /l %%i in (1,1,20) do (\r\n  del /f /q \"%~dp0uninstall-worker.exe\" >nul 2>&1\r\n  if not exist \"%~dp0uninstall-worker.exe\" goto done\r\n  ping 127.0.0.1 -n 2 >nul\r\n)\r\n:done\r\ndel /f /q \"%~dp0plan.json\" >nul 2>&1\r\ndel /f /q \"%~dp0journal.json\" >nul 2>&1\r\ndel /f /q \"%~dp0ready.json\" >nul 2>&1\r\ndel /f /q \"%~f0\" >nul 2>&1\r\nrmdir /s /q \"%~dp0\" >nul 2>&1\r\n",
    )?;
    let comspec = std::env::var_os("ComSpec").context("COMSPEC is unavailable")?;
    Command::new(comspec)
        .args(["/D", "/C"])
        .arg(&script)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()?;
    Ok(())
}

fn show_problem(journal: &UninstallJournal, message: &str, report: &Path, partial: bool) {
    let text = strings(&journal.plan.locale);
    let summary = if partial { text.partial } else { text.failed };
    let residual_paths = journal
        .issues
        .iter()
        .take(3)
        .map(|issue| format!("- {}", issue.path.display()))
        .collect::<Vec<_>>()
        .join("\n");
    let residual_preview = if residual_paths.is_empty() {
        String::new()
    } else {
        format!("\n\n{residual_paths}")
    };
    MessageDialog::new()
        .set_level(MessageLevel::Error)
        .set_title(text.title)
        .set_description(format!(
            "{summary}\n\nPhase: {:?}\nResidual items: {}\n{message}{residual_preview}\n\nLog: {}",
            journal.phase,
            journal.issues.len(),
            report.display()
        ))
        .show();
}

fn progress_detail(locale: &str) -> &'static str {
    match locale {
        "zh-CN" => "请勿关闭此窗口。卸载过程中会保留未选择删除的游戏和用户数据。",
        "zh-TW" => "請勿關閉此視窗。解除安裝期間會保留未選擇刪除的遊戲和使用者資料。",
        "ja-JP" => "このウィンドウを閉じないでください。選択されていないゲームとユーザーデータは保持されます。",
        "de-DE" => "Schließe dieses Fenster nicht. Nicht ausgewählte Spiele und Benutzerdaten bleiben erhalten.",
        _ => "Do not close this window. Games and user data not selected for removal will be preserved.",
    }
}

struct ProgressWindow {
    window: nwg::Window,
    status_label: nwg::Label,
    progress_bar: nwg::ProgressBar,
    timer: nwg::AnimationTimer,
    receiver: RefCell<Receiver<ProgressEvent>>,
    result: RefCell<Option<Result<WorkerOutcome, String>>>,
    started_at: Instant,
    finish_after: RefCell<Option<Instant>>,
    locale: String,
    _title_label: nwg::Label,
    _detail_label: nwg::Label,
    _title_font: nwg::Font,
    _body_font: nwg::Font,
}

impl ProgressWindow {
    fn build(
        locale: String,
        initial_phase: UninstallPhase,
        receiver: Receiver<ProgressEvent>,
    ) -> Result<Rc<Self>> {
        nwg::init().map_err(|error| anyhow::anyhow!("initialize uninstall UI: {error:?}"))?;
        nwg::Font::set_global_family("Segoe UI")
            .map_err(|error| anyhow::anyhow!("set uninstall UI font: {error:?}"))?;

        let text = strings(&locale);
        let mut title_font = nwg::Font::default();
        nwg::Font::builder()
            .family("Segoe UI")
            .size(26)
            .weight(600)
            .build(&mut title_font)
            .map_err(|error| anyhow::anyhow!("create uninstall title font: {error:?}"))?;
        let mut body_font = nwg::Font::default();
        nwg::Font::builder()
            .family("Segoe UI")
            .size(18)
            .build(&mut body_font)
            .map_err(|error| anyhow::anyhow!("create uninstall body font: {error:?}"))?;

        let mut window = nwg::Window::default();
        nwg::Window::builder()
            .flags(nwg::WindowFlags::WINDOW)
            .size((560, 240))
            .center(true)
            .topmost(true)
            .title(text.title)
            .build(&mut window)
            .map_err(|error| anyhow::anyhow!("create uninstall progress window: {error:?}"))?;

        let mut title_label = nwg::Label::default();
        nwg::Label::builder()
            .text(text.progress_title)
            .font(Some(&title_font))
            .size((500, 38))
            .position((28, 22))
            .parent(&window)
            .build(&mut title_label)
            .map_err(|error| anyhow::anyhow!("create uninstall progress title: {error:?}"))?;

        let mut status_label = nwg::Label::default();
        nwg::Label::builder()
            .text(phase_text(&locale, initial_phase))
            .font(Some(&body_font))
            .size((500, 28))
            .position((28, 76))
            .parent(&window)
            .build(&mut status_label)
            .map_err(|error| anyhow::anyhow!("create uninstall status text: {error:?}"))?;

        let mut progress_bar = nwg::ProgressBar::default();
        nwg::ProgressBar::builder()
            .range(0..100)
            .pos(phase_progress(initial_phase))
            .size((500, 24))
            .position((28, 112))
            .parent(&window)
            .build(&mut progress_bar)
            .map_err(|error| anyhow::anyhow!("create uninstall progress bar: {error:?}"))?;

        let mut detail_label = nwg::Label::default();
        nwg::Label::builder()
            .text(progress_detail(&locale))
            .font(Some(&body_font))
            .size((500, 48))
            .position((28, 154))
            .parent(&window)
            .build(&mut detail_label)
            .map_err(|error| anyhow::anyhow!("create uninstall progress detail: {error:?}"))?;

        let mut timer = nwg::AnimationTimer::default();
        nwg::AnimationTimer::builder()
            .parent(&window)
            .interval(Duration::from_millis(50))
            .active(true)
            .build(&mut timer)
            .map_err(|error| anyhow::anyhow!("create uninstall progress timer: {error:?}"))?;

        // Show the fully constructed window before the operation thread can publish ready.json.
        // This prevents Electron from beginning shutdown while the progress window is still in
        // its initial hidden/unpainted state.
        window.set_visible(true);
        window.set_focus();

        Ok(Rc::new(Self {
            window,
            status_label,
            progress_bar,
            timer,
            receiver: RefCell::new(receiver),
            result: RefCell::new(None),
            started_at: Instant::now(),
            finish_after: RefCell::new(None),
            locale,
            _title_label: title_label,
            _detail_label: detail_label,
            _title_font: title_font,
            _body_font: body_font,
        }))
    }

    fn poll(&self) {
        if self
            .finish_after
            .borrow()
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            nwg::stop_thread_dispatch();
            return;
        }

        let Ok(event) = self.receiver.borrow_mut().try_recv() else {
            return;
        };
        match event {
            ProgressEvent::Phase(phase) => {
                self.progress_bar.set_pos(phase_progress(phase));
                self.status_label.set_text(phase_text(&self.locale, phase));
            }
            ProgressEvent::Finished(result) => {
                if matches!(result, Ok(WorkerOutcome::Completed)) {
                    self.progress_bar.set_pos(100);
                    self.status_label
                        .set_text(phase_text(&self.locale, UninstallPhase::Finalized));
                    let earliest = self.started_at + MINIMUM_PROGRESS_WINDOW_DURATION;
                    let after_final_paint = Instant::now() + FINAL_PROGRESS_PAINT_DURATION;
                    *self.finish_after.borrow_mut() = Some(earliest.max(after_final_paint));
                } else {
                    nwg::stop_thread_dispatch();
                }
                *self.result.borrow_mut() = Some(result);
            }
        }
    }
}

fn run_worker_with_progress(plan_path: &Path) -> Result<()> {
    let plan: UninstallPlan = serde_json::from_slice(
        &fs::read(plan_path).with_context(|| format!("read {}", plan_path.display()))?,
    )
    .context("parse uninstall plan for progress UI")?;
    let journal_path = plan_path.with_file_name("journal.json");
    let initial_phase = fs::read(&journal_path)
        .ok()
        .and_then(|content| serde_json::from_slice::<UninstallJournal>(&content).ok())
        .filter(|journal| journal.plan.operation_id == plan.operation_id)
        .map(|journal| journal.phase)
        .unwrap_or(UninstallPhase::Prepared);
    let work_dir = plan_path
        .parent()
        .context("uninstall plan has no parent")?
        .to_path_buf();
    let (progress_sender, progress_receiver) = mpsc::channel();
    let locale = plan.locale.clone();
    let ui = ProgressWindow::build(plan.locale, initial_phase, progress_receiver)?;

    let worker_plan = plan_path.to_path_buf();
    let worker = thread::Builder::new()
        .name("bz-games-uninstall-operation".to_string())
        .spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                execute_worker(&worker_plan, Some(&progress_sender))
            }))
            .map_err(|_| "uninstall worker panicked".to_string())
            .and_then(|result| result.map_err(|error| format!("{error:#}")));
            let _ = progress_sender.send(ProgressEvent::Finished(result));
        })
        .context("start uninstall operation thread")?;

    let event_ui = ui.clone();
    let handler = nwg::full_bind_event_handler(
        &ui.window.handle,
        move |event, event_data, handle| match event {
            nwg::Event::OnTimerTick if handle == event_ui.timer.handle => event_ui.poll(),
            nwg::Event::OnWindowClose if handle == event_ui.window.handle => {
                if let nwg::EventData::OnWindowClose(close_data) = event_data {
                    close_data.close(false);
                }
            }
            _ => {}
        },
    );

    nwg::dispatch_thread_events();
    nwg::unbind_event_handler(&handler);
    worker
        .join()
        .map_err(|_| anyhow::anyhow!("uninstall operation thread panicked"))?;
    let result = ui
        .result
        .borrow_mut()
        .take()
        .context("uninstall operation ended without a result")?;
    match result {
        Ok(outcome) => {
            ui.window.set_visible(false);
            if outcome == WorkerOutcome::Completed {
                let text = strings(&locale);
                MessageDialog::new()
                    .set_level(MessageLevel::Info)
                    .set_title(text.title)
                    .set_description(text.success)
                    .show();
            }
            spawn_self_cleanup(&work_dir)?;
            Ok(())
        }
        Err(error) => bail!(error),
    }
}

fn execute_worker(
    plan_path: &Path,
    progress: Option<&Sender<ProgressEvent>>,
) -> Result<WorkerOutcome> {
    let work_dir = plan_path.parent().context("uninstall plan has no parent")?;
    let journal_path = work_dir.join("journal.json");
    let ready_path = work_dir.join("ready.json");
    let cancel_path = work_dir.join("cancel.json");
    let resuming = journal_path.is_file();
    let plan = load_plan_internal(plan_path, resuming)?;
    let expected_work_dir = work_root()?.join(plan.operation_id.to_string());
    if normalized_path(work_dir) != normalized_path(&expected_work_dir) {
        bail!("uninstall plan is outside its operation work directory");
    }
    ensure_no_reparse_ancestor(work_dir)?;
    validate_plain_directory(work_dir)?;
    validate_plain_file(&work_dir.join("uninstall-worker.exe"))?;
    std::env::set_current_dir(work_dir).with_context(|| {
        format!(
            "switch uninstall worker working directory to {}",
            work_dir.display()
        )
    })?;
    let mut journal = if resuming {
        let journal = serde_json::from_slice::<UninstallJournal>(&fs::read(&journal_path)?)?;
        if journal.format != JOURNAL_FORMAT
            || journal.format_version != PLAN_VERSION
            || journal.plan.operation_id != plan.operation_id
            || journal.plan.install_root != plan.install_root
        {
            bail!("invalid uninstall journal");
        }
        journal
    } else {
        validate_installation(&plan)?;
        if plan.delete_games {
            let _ = validated_game_libraries(&plan)?;
        }
        UninstallJournal {
            format: JOURNAL_FORMAT.to_string(),
            format_version: PLAN_VERSION,
            plan: plan.clone(),
            phase: UninstallPhase::Prepared,
            quarantined_launcher: None,
            issues: Vec::new(),
            updated_at: Utc::now().to_rfc3339(),
        }
    };
    if journal.phase < UninstallPhase::LauncherQuarantined {
        validate_installation(&plan)?;
    } else {
        validate_install_root(&plan)?;
    }
    if !resuming {
        write_journal(
            &journal_path,
            &mut journal,
            UninstallPhase::Prepared,
            progress,
        )?;
    }
    if cancel_path.is_file() {
        return Ok(WorkerOutcome::Canceled);
    }
    atomic_json(
        &ready_path,
        &serde_json::json!({"operationId": plan.operation_id, "ready": true}),
    )?;

    let operation = (|| -> Result<()> {
        if journal.phase < UninstallPhase::WaitingForProcesses {
            write_journal(
                &journal_path,
                &mut journal,
                UninstallPhase::WaitingForProcesses,
                progress,
            )?;
        }
        if journal.phase == UninstallPhase::WaitingForProcesses {
            if !wait_for_process_exit(plan.application_pid, Some(&cancel_path))? {
                return Ok(());
            }
            wait_for_application_tree()?;
            validate_installation(&plan)?;
            if plan.delete_games {
                let _ = validated_game_libraries(&plan)?;
            }
            write_journal(
                &journal_path,
                &mut journal,
                UninstallPhase::PreflightComplete,
                progress,
            )?;
        }

        if journal.phase < UninstallPhase::RecoveryRegistered {
            set_uninstall_command(
                &work_dir.join("uninstall-worker.exe"),
                &format!("--resume \"{}\"", journal_path.display()),
            )?;
            write_journal(
                &journal_path,
                &mut journal,
                UninstallPhase::RecoveryRegistered,
                progress,
            )?;
        }

        let launcher = plan.install_root.join("BZ-Games.exe");
        let quarantined = journal.quarantined_launcher.clone().unwrap_or_else(|| {
            plan.install_root
                .join(format!("BZ-Games.exe.uninstalling-{}", plan.operation_id))
        });
        if journal.phase < UninstallPhase::LauncherQuarantined {
            if launcher.exists() {
                retry_rename(&launcher, &quarantined).context("quarantine root launcher")?;
            } else if !quarantined.exists() {
                bail!("root launcher is missing before quarantine");
            }
            journal.quarantined_launcher = Some(quarantined.clone());
            write_journal(
                &journal_path,
                &mut journal,
                UninstallPhase::LauncherQuarantined,
                progress,
            )?;
        }

        if journal.phase < UninstallPhase::RuntimeRemoved {
            if plan.install_root.join(".runtime").exists() {
                run_velopack(&plan.install_root)?;
            }
            write_journal(
                &journal_path,
                &mut journal,
                UninstallPhase::RuntimeRemoved,
                progress,
            )?;
        }

        if journal.phase < UninstallPhase::ShellIntegrationRemoved {
            remove_shell_integration(&plan.install_root, &mut journal.issues);
            write_journal(
                &journal_path,
                &mut journal,
                UninstallPhase::ShellIntegrationRemoved,
                progress,
            )?;
        }

        if journal.phase < UninstallPhase::OptionalDataCleanup {
            cleanup_optional_data(&plan, &mut journal.issues);
            write_journal(
                &journal_path,
                &mut journal,
                UninstallPhase::OptionalDataCleanup,
                progress,
            )?;
        }

        if journal.phase < UninstallPhase::RootBinariesRemoved {
            retry_remove_plain_file(&quarantined)
                .with_context(|| format!("remove root launcher {}", quarantined.display()))?;
            let marker = plan.install_root.join(".bz-games-root");
            retry_remove_plain_file(&marker)
                .with_context(|| format!("remove installation marker {}", marker.display()))?;
            write_journal(
                &journal_path,
                &mut journal,
                UninstallPhase::RootBinariesRemoved,
                progress,
            )?;
        }

        if journal.phase < UninstallPhase::Finalized {
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            hkcu.delete_subkey_all(
                r"Software\Microsoft\Windows\CurrentVersion\Uninstall\com.bzgames.desktop",
            )
            .or_else(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    Ok(())
                } else {
                    Err(error)
                }
            })?;
            let root_uninstaller = plan.install_root.join("BZ-Games-Uninstall.exe");
            retry_remove_plain_file(&root_uninstaller).with_context(|| {
                format!(
                    "remove final root uninstaller {}; run it again to continue",
                    root_uninstaller.display()
                )
            })?;

            // The root uninstaller is deliberately the final persistent uninstall
            // target.  Do not write the journal after it has been removed: a
            // journal failure must never turn a completed uninstall into a failure.
            journal.phase = UninstallPhase::Finalized;
            journal.updated_at = Utc::now().to_rfc3339();
            if let Some(progress) = progress {
                let _ = progress.send(ProgressEvent::Phase(UninstallPhase::Finalized));
            }
        }
        Ok(())
    })();

    match operation {
        Ok(()) => {
            if cancel_path.is_file() && journal.phase < UninstallPhase::PreflightComplete {
                return Ok(WorkerOutcome::Canceled);
            }
            if !journal.issues.is_empty() {
                let report = write_report(&journal, None)?;
                show_problem(
                    &journal,
                    &format!("{} cleanup item(s) remain.", journal.issues.len()),
                    &report,
                    true,
                );
                return Ok(WorkerOutcome::CompletedWithIssues);
            }
            Ok(WorkerOutcome::Completed)
        }
        Err(error) => {
            let report = write_report(&journal, Some(&error))?;
            show_problem(&journal, &format!("{error:#}"), &report, false);
            ERROR_REPORTED.store(true, Ordering::SeqCst);
            Err(error)
        }
    }
}

fn wait_for_ready(
    work_dir: &Path,
    child: &mut std::process::Child,
    operation_id: Uuid,
) -> Result<()> {
    let ready = work_dir.join("ready.json");
    let expected_operation_id = operation_id.to_string();
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if ready.is_file() {
            let value: serde_json::Value = serde_json::from_slice(&fs::read(&ready)?)?;
            if value.get("operationId").and_then(|item| item.as_str())
                == Some(expected_operation_id.as_str())
                && value.get("ready").and_then(|item| item.as_bool()) == Some(true)
            {
                return Ok(());
            }
        }
        if let Some(status) = child.try_wait()? {
            bail!("uninstall worker exited before handoff with {status}");
        }
        thread::sleep(Duration::from_millis(100));
    }
    bail!("timed out waiting for uninstall worker handoff")
}

fn find_incomplete_journal(install_root: &Path) -> Result<Option<(PathBuf, UninstallJournal)>> {
    let root = work_root()?;
    let mut matches = Vec::new();
    for entry in fs::read_dir(root).into_iter().flatten().flatten() {
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let journal_path = entry.path().join("journal.json");
        let Ok(content) = fs::read(&journal_path) else {
            continue;
        };
        let Ok(journal) = serde_json::from_slice::<UninstallJournal>(&content) else {
            continue;
        };
        if journal.format == JOURNAL_FORMAT
            && journal.format_version == PLAN_VERSION
            && journal.phase != UninstallPhase::Finalized
            && normalized_path(&journal.plan.install_root) == normalized_path(install_root)
            && entry.path().join("uninstall-worker.exe").is_file()
        {
            matches.push((journal.updated_at.clone(), journal_path, journal));
        }
    }
    matches.sort_by(|left, right| right.0.cmp(&left.0));
    Ok(matches
        .into_iter()
        .next()
        .map(|(_, path, journal)| (path, journal)))
}

fn cancel_worker_handoff(work_dir: &Path, child: &mut std::process::Child, remove_work_dir: bool) {
    let _ = fs::write(work_dir.join("cancel.json"), b"{}\n");
    let _ = child.kill();
    let _ = child.wait();
    if remove_work_dir {
        let _ = fs::remove_dir_all(work_dir);
    }
}

fn start_system_uninstall() -> Result<()> {
    let locale = system_locale();
    let text = strings(&locale);
    if bz_games_process_running() {
        MessageDialog::new()
            .set_level(MessageLevel::Warning)
            .set_title(text.title)
            .set_description(text.running)
            .show();
        return Ok(());
    }
    if MessageDialog::new()
        .set_level(MessageLevel::Warning)
        .set_title(text.title)
        .set_description(text.confirm)
        .set_buttons(MessageButtons::YesNo)
        .show()
        != MessageDialogResult::Yes
    {
        return Ok(());
    }
    let current = std::env::current_exe()?;
    let root = current
        .parent()
        .context("uninstaller has no installation root")?;
    if let Some((journal_path, journal)) = find_incomplete_journal(root)? {
        let existing_work_dir = journal_path
            .parent()
            .context("uninstall journal has no parent")?;
        let ready_path = existing_work_dir.join("ready.json");
        let _ = fs::remove_file(&ready_path);
        let _ = fs::remove_file(existing_work_dir.join("cancel.json"));
        let worker = existing_work_dir.join("uninstall-worker.exe");
        let mut child = Command::new(&worker)
            .arg("--resume")
            .arg(&journal_path)
            .spawn()?;
        if let Err(error) = wait_for_ready(existing_work_dir, &mut child, journal.plan.operation_id)
        {
            cancel_worker_handoff(existing_work_dir, &mut child, false);
            return Err(error);
        }
        return Ok(());
    }
    let operation_id = Uuid::new_v4();
    let work_dir = work_root()?.join(operation_id.to_string());
    fs::create_dir_all(&work_dir)?;
    let worker = work_dir.join("uninstall-worker.exe");
    if let Err(error) = fs::copy(&current, &worker) {
        let _ = fs::remove_dir_all(&work_dir);
        return Err(error).context("copy uninstall worker");
    }
    let plan_path = work_dir.join("plan.json");
    let plan = UninstallPlan {
        format: PLAN_FORMAT.to_string(),
        format_version: PLAN_VERSION,
        operation_id,
        source: UninstallSource::System,
        locale,
        install_root: root.to_path_buf(),
        application_pid: std::process::id(),
        delete_games: false,
        delete_user_data: false,
        game_library_roots: Vec::new(),
        created_at: Utc::now().to_rfc3339(),
    };
    if let Err(error) = atomic_json(&plan_path, &plan) {
        let _ = fs::remove_dir_all(&work_dir);
        return Err(error).context("write system uninstall plan");
    }
    let mut child = match Command::new(&worker)
        .args(["--worker", "--plan"])
        .arg(&plan_path)
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_dir_all(&work_dir);
            return Err(error).context("start uninstall worker");
        }
    };
    if let Err(error) = wait_for_ready(&work_dir, &mut child, operation_id) {
        cancel_worker_handoff(&work_dir, &mut child, true);
        return Err(error);
    }
    Ok(())
}

fn run() -> Result<()> {
    let arguments: Vec<String> = std::env::args().collect();
    if arguments.iter().any(|argument| argument == "--version") {
        println!(
            "{}",
            option_env!("BZ_APP_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
        );
        return Ok(());
    }
    if arguments.iter().any(|argument| argument == "--worker") {
        let plan = argument_value(&arguments, "--plan").context("--plan is required")?;
        return run_worker_with_progress(Path::new(plan));
    }
    if arguments.iter().any(|argument| argument == "--resume") {
        let journal_path =
            PathBuf::from(argument_value(&arguments, "--resume").context("--resume is required")?);
        let journal: UninstallJournal = serde_json::from_slice(&fs::read(&journal_path)?)?;
        if journal.format != JOURNAL_FORMAT || journal.format_version != PLAN_VERSION {
            bail!("invalid uninstall journal");
        }
        let journal_dir = journal_path.parent().context("journal has no parent")?;
        let expected = work_root()?.join(journal.plan.operation_id.to_string());
        if normalized_path(journal_dir) != normalized_path(&expected) {
            bail!("uninstall journal is outside its operation work directory");
        }
        let plan_path = journal_path.with_file_name("plan.json");
        if !plan_path.is_file() {
            atomic_json(&plan_path, &journal.plan)?;
        }
        return run_worker_with_progress(&plan_path);
    }
    start_system_uninstall()
}

fn main() {
    let direct_worker = std::env::args().any(|argument| argument == "--worker");
    if let Err(error) = run() {
        if !direct_worker && !ERROR_REPORTED.load(Ordering::SeqCst) {
            let locale = system_locale();
            let text = strings(&locale);
            MessageDialog::new()
                .set_level(MessageLevel::Error)
                .set_title(text.title)
                .set_description(format!("{}\n\n{error:#}", text.failed))
                .show();
        }
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_plan(root: PathBuf, source: UninstallSource) -> UninstallPlan {
        UninstallPlan {
            format: PLAN_FORMAT.to_string(),
            format_version: PLAN_VERSION,
            operation_id: Uuid::new_v4(),
            source,
            locale: "zh-CN".to_string(),
            install_root: root,
            application_pid: 123,
            delete_games: false,
            delete_user_data: false,
            game_library_roots: Vec::new(),
            created_at: Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn system_plan_preserves_user_data() -> Result<()> {
        let root = std::env::temp_dir().join(format!("bz-uninstall-plan-{}", Uuid::new_v4()));
        fs::create_dir_all(&root)?;
        let path = root.join("plan.json");
        atomic_json(&path, &sample_plan(root.clone(), UninstallSource::System))?;
        let loaded = load_plan(&path)?;
        assert!(!loaded.delete_games);
        assert!(!loaded.delete_user_data);
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn system_plan_rejects_data_deletion() -> Result<()> {
        let root = std::env::temp_dir().join(format!("bz-uninstall-plan-{}", Uuid::new_v4()));
        fs::create_dir_all(&root)?;
        let path = root.join("plan.json");
        let mut plan = sample_plan(root.clone(), UninstallSource::System);
        plan.delete_user_data = true;
        atomic_json(&path, &plan)?;
        assert!(load_plan(&path).is_err());
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn path_contains_respects_component_boundary() {
        assert!(path_contains(
            Path::new(r"C:\Games"),
            Path::new(r"C:\Games\One")
        ));
        assert!(!path_contains(
            Path::new(r"C:\Games"),
            Path::new(r"C:\Games2")
        ));
    }

    #[test]
    fn phases_follow_the_committed_state_machine_order() {
        assert!(UninstallPhase::Prepared < UninstallPhase::WaitingForProcesses);
        assert!(UninstallPhase::RecoveryRegistered < UninstallPhase::LauncherQuarantined);
        assert!(UninstallPhase::RuntimeRemoved < UninstallPhase::RootBinariesRemoved);
        assert!(UninstallPhase::RootBinariesRemoved < UninstallPhase::Finalized);
    }

    #[test]
    fn progress_follows_the_state_machine_and_finishes_at_one_hundred() {
        let phases = [
            UninstallPhase::Prepared,
            UninstallPhase::WaitingForProcesses,
            UninstallPhase::PreflightComplete,
            UninstallPhase::RecoveryRegistered,
            UninstallPhase::LauncherQuarantined,
            UninstallPhase::RuntimeRemoved,
            UninstallPhase::ShellIntegrationRemoved,
            UninstallPhase::OptionalDataCleanup,
            UninstallPhase::RootBinariesRemoved,
            UninstallPhase::Finalized,
        ];
        let values = phases.map(phase_progress);
        assert!(values.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(values[values.len() - 1], 100);
        assert_eq!(phase_text("zh-CN", UninstallPhase::Finalized), "卸载完成。");
        assert!(!strings("zh-CN").success.is_empty());
    }

    #[test]
    fn runtime_cleanup_removes_a_leftover_directory_tree() -> Result<()> {
        let runtime = std::env::temp_dir().join(format!("bz-runtime-cleanup-{}", Uuid::new_v4()));
        let current = runtime.join("current");
        fs::create_dir_all(&current)?;
        fs::write(current.join("leftover.tmp"), b"leftover")?;

        retry_remove_runtime_directory(&runtime)?;

        assert!(!runtime.exists());
        Ok(())
    }

    #[test]
    fn velopack_resume_removes_runtime_residue_without_an_updater() -> Result<()> {
        let root = std::env::temp_dir().join(format!("bz-velopack-resume-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join(".runtime").join("current"))?;

        run_velopack(&root)?;

        assert!(!root.join(".runtime").exists());
        fs::remove_dir(root)?;
        Ok(())
    }

    #[test]
    fn expired_plan_is_allowed_only_for_recovery() -> Result<()> {
        let root = std::env::temp_dir().join(format!("bz-uninstall-plan-{}", Uuid::new_v4()));
        fs::create_dir_all(&root)?;
        let path = root.join("plan.json");
        let mut plan = sample_plan(root.clone(), UninstallSource::InApp);
        plan.created_at = (Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
        atomic_json(&path, &plan)?;
        assert!(load_plan_internal(&path, false).is_err());
        assert!(load_plan_internal(&path, true).is_ok());
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn install_root_accepts_windows_extended_length_spelling() -> Result<()> {
        let root = std::env::temp_dir().join(format!("bz-uninstall-root-{}", Uuid::new_v4()));
        fs::create_dir_all(&root)?;
        let extended = PathBuf::from(format!(r"\\?\{}", root.display()));
        let plan = sample_plan(extended, UninstallSource::InApp);

        validate_install_root(&plan)?;

        fs::remove_dir_all(root)?;
        Ok(())
    }
}
