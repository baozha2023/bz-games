#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use anyhow::{bail, Context, Result};
use chrono::Utc;
use rfd::{MessageDialog, MessageLevel};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::os::windows::{ffi::OsStrExt, fs::MetadataExt};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command},
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE},
        Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH},
        System::Threading::CreateMutexW,
    },
};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const HEALTH_TIMEOUT: Duration = Duration::from_secs(30);
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

struct LauncherMutex(HANDLE);

impl Drop for LauncherMutex {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.0) };
    }
}

fn acquire_launcher_mutex(root: &Path) -> Result<Option<LauncherMutex>> {
    let normalized = root.to_string_lossy().replace('/', "\\").to_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    let name: Vec<u16> = format!("Local\\BZGamesLauncher-{digest:x}")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let handle = unsafe { CreateMutexW(None, false, PCWSTR(name.as_ptr())) }?;
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        unsafe { CloseHandle(handle) }?;
        return Ok(None);
    }
    Ok(Some(LauncherMutex(handle)))
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PendingUpdate {
    format: String,
    source_version: String,
    target_version: String,
    failure_count: u32,
    created_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RollbackState {
    format: String,
    source_version: String,
    target_version: String,
    package_file: String,
    package_sha256: String,
    created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HealthRecord {
    format: String,
    version: String,
    process_id: u32,
    healthy_at: String,
}

#[derive(Debug, PartialEq, Eq)]
enum UpdateHealthStatus {
    Updated,
    ApplyFailed,
    UnexpectedVersion,
}

fn classify_update_health(update: &PendingUpdate, health: &HealthRecord) -> UpdateHealthStatus {
    if health.version == update.target_version {
        UpdateHealthStatus::Updated
    } else if health.version == update.source_version {
        UpdateHealthStatus::ApplyFailed
    } else {
        UpdateHealthStatus::UnexpectedVersion
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PendingImportRollback {
    format: String,
    created_at: String,
    source_backup: PathBuf,
    #[serde(default)]
    external_manifest_paths: Vec<PathBuf>,
}

fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&temporary, serde_json::to_vec(value)?)?;
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

fn copy_tree(source: &Path, target: &Path) -> Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)?;
        if metadata.file_type().is_symlink() {
            bail!("refusing to copy a linked rollback entry");
        }
        if metadata.is_dir() {
            copy_tree(&source_path, &target_path)?;
        } else if metadata.is_file() {
            fs::copy(source_path, target_path)?;
        } else {
            bail!("refusing to copy a special rollback entry");
        }
    }
    Ok(())
}

fn validate_plain_file(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        bail!("expected a regular rollback file: {}", path.display());
    }
    Ok(())
}

fn validate_plain_directory(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        bail!("expected a regular rollback directory: {}", path.display());
    }
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();
        let metadata = fs::symlink_metadata(&entry_path)?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            bail!(
                "rollback data contains a reparse point: {}",
                entry_path.display()
            );
        }
        if metadata.is_dir() {
            validate_plain_directory(&entry_path)?;
        } else if !metadata.is_file() {
            bail!(
                "rollback data contains a special file: {}",
                entry_path.display()
            );
        }
    }
    Ok(())
}

fn load_rollback_state(root: &Path) -> Result<(PathBuf, RollbackState)> {
    let rollback_root = root.join(".runtime").join("rollback");
    let manifest_path = rollback_root.join("rollback-state.json");
    validate_plain_file(&manifest_path)?;
    let rollback: RollbackState = serde_json::from_slice(&fs::read(&manifest_path)?)?;
    if rollback.format != "bz-games-rollback-state" {
        bail!("invalid rollback state format");
    }
    chrono::DateTime::parse_from_rfc3339(&rollback.created_at)
        .context("invalid rollback creation time")?;
    let source = Version::parse(&rollback.source_version)?;
    let target = Version::parse(&rollback.target_version)?;
    if source >= target {
        bail!("rollback version relationship is invalid");
    }
    if rollback.package_file.is_empty()
        || Path::new(&rollback.package_file)
            .file_name()
            .and_then(|value| value.to_str())
            != Some(rollback.package_file.as_str())
        || !rollback
            .package_file
            .to_lowercase()
            .ends_with("-full.nupkg")
    {
        bail!("rollback package name is invalid");
    }
    if rollback.package_sha256.len() != 64
        || !rollback
            .package_sha256
            .bytes()
            .all(|value| value.is_ascii_hexdigit())
        || rollback.package_sha256 != rollback.package_sha256.to_lowercase()
    {
        bail!("rollback package checksum is invalid");
    }
    let package = rollback_root.join(&rollback.package_file);
    validate_plain_file(&package)?;
    validate_plain_file(&rollback_root.join("config.json"))?;
    validate_plain_directory(&rollback_root.join("db"))?;
    if sha256_file(&package)? != rollback.package_sha256 {
        bail!("rollback package checksum mismatch");
    }
    Ok((rollback_root, rollback))
}

fn validate_pending_update(pending: &PendingUpdate) -> Result<()> {
    if pending.format != "bz-games-pending-update" {
        bail!("invalid pending update format");
    }
    let source = Version::parse(&pending.source_version)?;
    let target = Version::parse(&pending.target_version)?;
    if source >= target || pending.failure_count > 2 {
        bail!("invalid pending update state");
    }
    chrono::DateTime::parse_from_rfc3339(&pending.created_at)
        .context("invalid pending update creation time")?;
    Ok(())
}

fn prepare_restored_data(rollback_root: &Path, state_root: &Path) -> Result<PathBuf> {
    let staging = state_root.join(format!("rollback-data-staging-{}", Uuid::new_v4()));
    fs::create_dir_all(&staging)?;
    let result = (|| -> Result<()> {
        fs::copy(
            rollback_root.join("config.json"),
            staging.join("config.json"),
        )?;
        copy_tree(&rollback_root.join("db"), &staging.join("db"))?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    Ok(staging)
}

fn commit_restored_data(root: &Path, state_root: &Path, staging: &Path) -> Result<()> {
    let previous = state_root.join(format!("data-before-rollback-{}", Uuid::new_v4()));
    fs::create_dir_all(&previous)?;
    let result = (|| -> Result<()> {
        for name in ["config.json", "db"] {
            let current = root.join(name);
            if current.exists() {
                fs::rename(&current, previous.join(name))?;
            }
        }
        fs::rename(staging.join("config.json"), root.join("config.json"))?;
        fs::rename(staging.join("db"), root.join("db"))?;
        Ok(())
    })();
    if let Err(error) = result {
        for name in ["config.json", "db"] {
            let current = root.join(name);
            if current.is_file() {
                let _ = fs::remove_file(&current);
            } else if current.is_dir() {
                let _ = fs::remove_dir_all(&current);
            }
            let saved = previous.join(name);
            if saved.exists() {
                let _ = fs::rename(saved, current);
            }
        }
        return Err(error);
    }
    fs::remove_dir_all(previous)?;
    fs::remove_dir_all(staging)?;
    Ok(())
}

fn find_pending_import_rollback(root: &Path) -> Result<Option<(PathBuf, PendingImportRollback)>> {
    let parent = root.join(".backup-rollback");
    if !parent.is_dir() {
        return Ok(None);
    }
    let mut candidates = Vec::new();
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let rollback_root = entry.path();
        let metadata = fs::symlink_metadata(&rollback_root)?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            bail!(
                "import rollback directory is a reparse point: {}",
                rollback_root.display()
            );
        }
        if !metadata.is_dir() {
            continue;
        }
        let marker = rollback_root.join("pending-health.json");
        if !marker.is_file() {
            continue;
        }
        validate_plain_directory(&rollback_root)?;
        validate_plain_file(&marker)?;
        let pending: PendingImportRollback = serde_json::from_slice(&fs::read(marker)?)?;
        if pending.format != "bzgames-import-rollback" {
            bail!("invalid import rollback marker");
        }
        chrono::DateTime::parse_from_rfc3339(&pending.created_at)
            .context("invalid import rollback creation time")?;
        candidates.push((rollback_root, pending));
    }
    candidates.sort_by(|left, right| left.1.created_at.cmp(&right.1.created_at));
    Ok(candidates.pop())
}

fn restore_import(
    root: &Path,
    state: &Path,
    rollback_root: &Path,
    pending: &PendingImportRollback,
) -> Result<()> {
    let failed = state.join(format!(
        "failed-import-data-{}",
        Utc::now().timestamp_millis()
    ));
    fs::create_dir_all(&failed)?;
    let names = ["config.json", "games", "db"];
    let current_existed = names.map(|name| root.join(name).exists());
    let previous_existed = names.map(|name| rollback_root.join(name).exists());
    let result = (|| -> Result<()> {
        for name in names {
            let current = root.join(name);
            if current.exists() {
                fs::rename(&current, failed.join(name))?;
            }
            let previous = rollback_root.join(name);
            if previous.exists() {
                fs::rename(previous, &current)?;
            }
        }

        let external = rollback_root.join("external-manifests");
        for (index, manifest_path) in pending.external_manifest_paths.iter().enumerate() {
            if !manifest_path.is_absolute()
                || manifest_path.file_name().and_then(|value| value.to_str()) != Some("game.json")
            {
                bail!(
                    "invalid external manifest path: {}",
                    manifest_path.display()
                );
            }
            let backup = external.join(format!("{index}.game.json"));
            validate_plain_file(&backup)?;
            validate_plain_file(manifest_path)?;
            fs::copy(backup, manifest_path).with_context(|| {
                format!("restore external manifest {}", manifest_path.display())
            })?;
        }
        fs::rename(
            rollback_root.join("pending-health.json"),
            rollback_root.join("restored-after-failure.json"),
        )?;
        Ok(())
    })();
    if let Err(error) = result {
        for (index, name) in names.into_iter().enumerate().rev() {
            let current = root.join(name);
            let previous = rollback_root.join(name);
            if previous_existed[index] && current.exists() && !previous.exists() {
                let _ = fs::rename(&current, &previous);
            }
            let saved = failed.join(name);
            if current_existed[index] && saved.exists() && !current.exists() {
                let _ = fs::rename(saved, current);
            }
        }
        let _ = fs::remove_dir(&failed);
        return Err(error);
    }
    Ok(())
}

fn start_runtime(root: &Path, token: Option<Uuid>, forward_arguments: bool) -> Result<Child> {
    let runtime_entry = root.join(".runtime").join("BZ-Games.exe");
    if !runtime_entry.is_file() {
        bail!(
            "Velopack stable entry is missing: {}",
            runtime_entry.display()
        );
    }
    let mut command = Command::new(runtime_entry);
    if forward_arguments {
        command.args(std::env::args_os().skip(1));
    }
    command
        .env("BZ_GAMES_DATA_ROOT", root)
        .env_remove("BZ_GAMES_LAUNCH_TOKEN")
        .current_dir(root);
    if let Some(token) = token {
        command.env("BZ_GAMES_LAUNCH_TOKEN", token.to_string());
    }
    command.spawn().context("start BZ-Games runtime")
}

fn wait_for_health(child: &mut Child, health_path: &Path) -> Result<Option<HealthRecord>> {
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    while Instant::now() < deadline {
        if health_path.is_file() {
            let health: HealthRecord = serde_json::from_slice(&fs::read(health_path)?)?;
            if health.format != "bz-games-health"
                || health.process_id != child.id()
                || Version::parse(&health.version).is_err()
                || chrono::DateTime::parse_from_rfc3339(&health.healthy_at).is_err()
            {
                bail!("invalid application health record");
            }
            return Ok(Some(health));
        }
        if child.try_wait()?.is_some() {
            return Ok(None);
        }
        thread::sleep(Duration::from_millis(250));
    }
    Ok(None)
}

fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn wait_for_health_or_terminate(
    child: &mut Child,
    health_path: &Path,
) -> Result<Option<HealthRecord>> {
    match wait_for_health(child, health_path) {
        Ok(health) => Ok(health),
        Err(error) => {
            terminate_child(child);
            Err(error)
        }
    }
}

fn update_display_version(version: &str) -> Result<()> {
    Version::parse(version).context("invalid application version for uninstall registry")?;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (uninstall, _) = hkcu.create_subkey(
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall\com.bzgames.desktop",
    )?;
    uninstall.set_value("DisplayVersion", &version)?;
    Ok(())
}

fn write_rollback_suppression(state: &Path, version: &str) -> Result<()> {
    Version::parse(version)?;
    #[derive(Serialize)]
    struct Suppression<'a> {
        format: &'a str,
        version: &'a str,
    }
    atomic_json(
        &state.join("rollback-suppression.json"),
        &Suppression {
            format: "bz-games-rollback-suppression",
            version,
        },
    )
}

fn apply_rollback(root: &Path, state: &Path, expected_current: &str) -> Result<RollbackState> {
    let (rollback_root, rollback) = load_rollback_state(root)?;
    if rollback.target_version != expected_current {
        bail!("rollback point does not belong to the current installed version");
    }
    let staging = prepare_restored_data(&rollback_root, state)?;
    let updater = root.join(".runtime").join("Update.exe");
    validate_plain_file(&updater)?;
    let status = Command::new(updater)
        .args(["apply", "--package"])
        .arg(rollback_root.join(&rollback.package_file))
        .args(["--silent", "--norestart"])
        .current_dir(root)
        .status()?;
    if !status.success() {
        let _ = fs::remove_dir_all(staging);
        bail!("Velopack rollback failed with {status}");
    }
    commit_restored_data(root, state, &staging)?;
    write_rollback_suppression(state, &rollback.source_version)?;
    fs::remove_file(state.join("pending-update.json")).ok();
    Ok(rollback)
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn finish_healthy_launch(health_path: &Path, health: &HealthRecord) -> Result<()> {
    update_display_version(&health.version)?;
    fs::remove_file(health_path).ok();
    Ok(())
}

fn run() -> Result<()> {
    let launcher = std::env::current_exe()?;
    let root = launcher
        .parent()
        .context("launcher has no parent")?
        .to_path_buf();
    if fs::read_to_string(root.join(".bz-games-root"))?.trim() != "bz-games-root-v1" {
        bail!("invalid BZ-Games installation root marker");
    }
    std::env::set_current_dir(&root).context("move launcher working directory to install root")?;
    let Some(_launcher_mutex) = acquire_launcher_mutex(&root)? else {
        start_runtime(&root, None, true)?;
        return Ok(());
    };
    let state = root.join(".runtime").join("state");
    fs::create_dir_all(&state)?;
    let pending_path = state.join("pending-update.json");
    let mut pending = if pending_path.is_file() {
        let pending = serde_json::from_slice::<PendingUpdate>(&fs::read(&pending_path)?)?;
        validate_pending_update(&pending)?;
        Some(pending)
    } else {
        None
    };
    let token = Uuid::new_v4();
    let health_path = state.join(format!("healthy-{token}.json"));
    let mut child = start_runtime(&root, Some(token), true)?;
    if let Some(health) = wait_for_health_or_terminate(&mut child, &health_path)? {
        if let Some(update) = pending.as_ref() {
            match classify_update_health(update, &health) {
                UpdateHealthStatus::Updated => {}
                UpdateHealthStatus::ApplyFailed => {
                    finish_healthy_launch(&health_path, &health)?;
                    fs::remove_file(&pending_path).ok();
                    fs::remove_dir_all(root.join(".runtime").join("rollback")).ok();
                    return Ok(());
                }
                UpdateHealthStatus::UnexpectedVersion => {
                    terminate_child(&mut child);
                    bail!("updated application reported an unexpected version");
                }
            }
        }
        finish_healthy_launch(&health_path, &health)?;
        if pending.is_some() {
            fs::remove_file(&pending_path).context("clear completed pending update")?;
            fs::remove_dir_all(root.join(".runtime").join("rollback")).ok();
        }
        return Ok(());
    }
    terminate_child(&mut child);
    if let Some((rollback_root, import)) = find_pending_import_rollback(&root)? {
        restore_import(&root, &state, &rollback_root, &import)?;
        let restored_token = Uuid::new_v4();
        let restored_health = state.join(format!("healthy-{restored_token}.json"));
        let mut restored = start_runtime(&root, Some(restored_token), false)?;
        if let Some(health) = wait_for_health_or_terminate(&mut restored, &restored_health)? {
            finish_healthy_launch(&restored_health, &health)?;
            let _ = fs::remove_dir_all(rollback_root);
            return Ok(());
        }
        terminate_child(&mut restored);
        bail!("BZ-Games failed health startup after restoring imported data");
    }
    if let Some(ref mut update) = pending {
        update.failure_count = update.failure_count.saturating_add(1).min(2);
        atomic_json(&pending_path, update)?;
        if update.failure_count >= 2 {
            let rollback = apply_rollback(&root, &state, &update.target_version)?;
            let restored_token = Uuid::new_v4();
            let restored_health = state.join(format!("healthy-{restored_token}.json"));
            let mut restored = start_runtime(&root, Some(restored_token), false)?;
            if let Some(health) = wait_for_health_or_terminate(&mut restored, &restored_health)? {
                if health.version != rollback.source_version {
                    terminate_child(&mut restored);
                    bail!("automatically restored application reported an unexpected version");
                }
                finish_healthy_launch(&restored_health, &health)?;
                fs::remove_dir_all(root.join(".runtime").join("rollback"))?;
                return Ok(());
            }
            terminate_child(&mut restored);
            bail!("BZ-Games failed health startup after automatic rollback");
        }
    }
    bail!("BZ-Games did not complete its health startup within 30 seconds")
}

fn main() {
    if let Err(error) = run() {
        let mut automatic_rollback_attempted = false;
        let root = std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(Path::to_path_buf));
        if let Some(root) = root {
            let pending_rollback_failed = fs::read(
                root.join(".runtime")
                    .join("state")
                    .join("pending-update.json"),
            )
            .ok()
            .and_then(|content| serde_json::from_slice::<PendingUpdate>(&content).ok())
            .is_some_and(|pending| pending.failure_count >= 2);
            automatic_rollback_attempted = pending_rollback_failed
                || root
                    .join(".runtime")
                    .join("state")
                    .join("rollback-suppression.json")
                    .is_file();
            let log = root
                .join(".runtime")
                .join("state")
                .join("launcher-error.log");
            let _ = fs::create_dir_all(log.parent().unwrap_or(&root));
            let _ = fs::write(log, format!("{}\n{error:#}\n", Utc::now().to_rfc3339()));
        }
        if automatic_rollback_attempted {
            MessageDialog::new()
                .set_level(MessageLevel::Error)
                .set_title("BZ-Games Rollback")
                .set_description(format!(
                    "Rollback was stopped to protect your data:\n{error:#}"
                ))
                .show();
        }
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_rollback(root: &Path) -> Result<RollbackState> {
        let rollback_root = root.join(".runtime").join("rollback");
        fs::create_dir_all(rollback_root.join("db"))?;
        let package_file = "com.bzgames.desktop-4.0.0-stable-full.nupkg";
        fs::write(rollback_root.join(package_file), b"package")?;
        fs::write(rollback_root.join("config.json"), b"config")?;
        fs::write(rollback_root.join("db").join("bz_games.db"), b"database")?;
        let rollback = RollbackState {
            format: "bz-games-rollback-state".to_string(),
            source_version: "4.0.0".to_string(),
            target_version: "4.0.1".to_string(),
            package_file: package_file.to_string(),
            package_sha256: sha256_file(&rollback_root.join(package_file))?,
            created_at: Utc::now().to_rfc3339(),
        };
        atomic_json(&rollback_root.join("rollback-state.json"), &rollback)?;
        Ok(rollback)
    }

    #[test]
    fn sha256_file_hashes_without_loading_the_package_into_memory() -> Result<()> {
        let file_path =
            std::env::temp_dir().join(format!("bz-games-launcher-sha256-test-{}", Uuid::new_v4()));
        fs::write(&file_path, b"abc")?;
        assert_eq!(
            sha256_file(&file_path)?,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        fs::remove_file(file_path)?;
        Ok(())
    }

    #[test]
    fn rollback_state_uses_fixed_paths_and_rejects_tampering() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("bz-games-launcher-state-test-{}", Uuid::new_v4()));
        create_test_rollback(&root)?;

        let (_, rollback) = load_rollback_state(&root)?;
        assert_eq!(rollback.source_version, "4.0.0");
        fs::write(
            root.join(".runtime")
                .join("rollback")
                .join(&rollback.package_file),
            b"tampered",
        )?;
        assert!(load_rollback_state(&root).is_err());
        fs::remove_dir_all(root)?;
        Ok(())
    }

    #[test]
    fn pending_update_requires_an_upgrade_relationship() {
        let valid = PendingUpdate {
            format: "bz-games-pending-update".to_string(),
            source_version: "4.0.0".to_string(),
            target_version: "4.0.1".to_string(),
            failure_count: 1,
            created_at: Utc::now().to_rfc3339(),
        };
        assert!(validate_pending_update(&valid).is_ok());
        let invalid = PendingUpdate {
            target_version: "3.4.2".to_string(),
            ..valid
        };
        assert!(validate_pending_update(&invalid).is_err());
    }

    #[test]
    fn pending_update_only_accepts_the_target_as_a_successful_update() {
        let update = PendingUpdate {
            format: "bz-games-pending-update".to_string(),
            source_version: "4.0.0".to_string(),
            target_version: "4.0.1".to_string(),
            failure_count: 0,
            created_at: Utc::now().to_rfc3339(),
        };
        let health = |version: &str| HealthRecord {
            format: "bz-games-health".to_string(),
            version: version.to_string(),
            process_id: 1,
            healthy_at: Utc::now().to_rfc3339(),
        };

        assert_eq!(
            classify_update_health(&update, &health("4.0.1")),
            UpdateHealthStatus::Updated
        );
        assert_eq!(
            classify_update_health(&update, &health("4.0.0")),
            UpdateHealthStatus::ApplyFailed
        );
        assert_eq!(
            classify_update_health(&update, &health("4.0.2")),
            UpdateHealthStatus::UnexpectedVersion
        );
    }

    #[test]
    fn failed_import_restore_puts_the_active_data_back() -> Result<()> {
        let root =
            std::env::temp_dir().join(format!("bz-games-import-restore-test-{}", Uuid::new_v4()));
        let state = root.join(".runtime").join("state");
        let rollback_root = root.join(".backup-rollback").join("test");
        fs::create_dir_all(&state)?;
        fs::create_dir_all(&rollback_root)?;
        fs::write(root.join("config.json"), b"active")?;
        fs::write(rollback_root.join("config.json"), b"previous")?;
        let pending = PendingImportRollback {
            format: "bzgames-import-rollback".to_string(),
            created_at: Utc::now().to_rfc3339(),
            source_backup: root.join("backup.bzbackup"),
            external_manifest_paths: vec![PathBuf::from("relative-game.json")],
        };

        assert!(restore_import(&root, &state, &rollback_root, &pending).is_err());
        assert_eq!(fs::read(root.join("config.json"))?, b"active");
        assert_eq!(fs::read(rollback_root.join("config.json"))?, b"previous");
        fs::remove_dir_all(root)?;
        Ok(())
    }
}
