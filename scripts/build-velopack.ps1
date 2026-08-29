param(
  [switch]$FullOnly
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json).version
$cargo = Join-Path $env:USERPROFILE ".cargo\bin\cargo.exe"
$vpk = Join-Path $env:USERPROFILE ".dotnet\tools\vpk.exe"
$nativeManifest = Join-Path $repoRoot "native\bootstrap\Cargo.toml"
$appIcon = Join-Path $repoRoot "resources\icon.ico"
$installerLogoLayers = @(
  (Join-Path $repoRoot "resources\installer-logo-q1.png"),
  (Join-Path $repoRoot "resources\installer-logo-q2.png"),
  (Join-Path $repoRoot "resources\installer-logo-q3.png"),
  (Join-Path $repoRoot "resources\installer-logo-q4.png")
)
$electronDir = Join-Path $repoRoot "dist\win-unpacked"
$releaseDir = Join-Path $repoRoot "dist\velopack"
$launcher = Join-Path $repoRoot "native\bootstrap\target\release\bz-games-launcher.exe"
$uninstaller = Join-Path $repoRoot "native\bootstrap\target\release\bz-games-uninstaller.exe"
$repoUrl = "https://github.com/baozha2023/bz-games"
$fullOnlyBuild = $FullOnly.IsPresent -or $version -eq "4.0.0"

if (-not (Test-Path -LiteralPath $cargo -PathType Leaf)) {
  throw "Rust toolchain is required: $cargo"
}
if (-not (Test-Path -LiteralPath $vpk -PathType Leaf)) {
  throw "Velopack CLI 1.2.0 is required: dotnet tool install --global vpk --version 1.2.0"
}
if (-not (Test-Path -LiteralPath $appIcon -PathType Leaf)) {
  throw "Windows application icon is missing: $appIcon"
}
foreach ($logoLayer in $installerLogoLayers) {
  if (-not (Test-Path -LiteralPath $logoLayer -PathType Leaf)) {
    throw "Installer animation logo layer is missing: $logoLayer"
  }
}

Set-Location -LiteralPath $repoRoot
$env:BZ_APP_VERSION = $version
& $cargo build --release --manifest-path $nativeManifest --bin bz-games-launcher
if ($LASTEXITCODE -ne 0) { throw "Root launcher build failed" }
& $cargo build --release --manifest-path $nativeManifest --bin bz-games-uninstaller
if ($LASTEXITCODE -ne 0) { throw "Root uninstaller build failed" }
npm run build:electron-win
if ($LASTEXITCODE -ne 0) { throw "Electron Windows package build failed" }

if (Test-Path -LiteralPath $releaseDir) {
  Remove-Item -LiteralPath $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

if (-not $fullOnlyBuild) {
  $downloadArgs = @(
    "download", "github",
    "--repoUrl", $repoUrl,
    "--channel", "stable",
    "--outputDir", $releaseDir
  )
  if ($env:GITHUB_TOKEN) {
    $downloadArgs += @("--token", $env:GITHUB_TOKEN)
  }
  & $vpk @downloadArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to download the previous stable Velopack full package; use -FullOnly only for an intentional full-only release"
  }
}

$packArgs = @(
  "pack",
  "--packId", "com.bzgames.desktop",
  "--packVersion", $version,
  "--packTitle", "BZ-Games",
  "--packAuthors", "baozha2023",
  "--icon", $appIcon,
  "--packDir", $electronDir,
  "--mainExe", "BZ-Games.exe",
  "--outputDir", $releaseDir,
  "--channel", "stable",
  "--shortcuts", "None",
  "--noPortable"
)
if ($fullOnlyBuild) {
  $packArgs += @("--delta", "None")
}
& $vpk @packArgs
if ($LASTEXITCODE -ne 0) { throw "Velopack package build failed" }

$velopackSetups = @(Get-ChildItem -LiteralPath $releaseDir -Filter "*-stable-Setup.exe" -File)
if ($velopackSetups.Count -ne 1) {
  throw "Expected exactly one Velopack Setup executable, found $($velopackSetups.Count)"
}
$velopackSetup = $velopackSetups[0]

$env:BZ_VELOPACK_SETUP_PATH = $velopackSetup.FullName
$env:BZ_ROOT_LAUNCHER_PATH = $launcher
$env:BZ_ROOT_UNINSTALLER_PATH = $uninstaller
$installedSizeBytes = [int64]((Get-ChildItem -LiteralPath $electronDir -Recurse -File -Force | Measure-Object -Property Length -Sum).Sum)
$installedSizeBytes += [int64](Get-Item -LiteralPath $launcher).Length
$installedSizeBytes += [int64](Get-Item -LiteralPath $uninstaller).Length
$env:BZ_INSTALLED_SIZE_BYTES = [string]$installedSizeBytes
& $cargo build --release --manifest-path $nativeManifest --bin bz-games-installer
if ($LASTEXITCODE -ne 0) { throw "Custom installer build failed" }

$installer = Join-Path $repoRoot "native\bootstrap\target\release\bz-games-installer.exe"
$finalInstaller = Join-Path $releaseDir "BZ-Games-Setup-$version.exe"
Copy-Item -LiteralPath $installer -Destination $finalInstaller -Force

if (-not (Test-Path -LiteralPath $finalInstaller -PathType Leaf)) {
  throw "Final installer is missing: $finalInstaller"
}
$currentFull = @(Get-ChildItem -LiteralPath $releaseDir -Filter "*-$version-*-full.nupkg" -File)
if ($currentFull.Count -ne 1) {
  throw "Expected exactly one current full package, found $($currentFull.Count)"
}
$stableFeedPath = Join-Path $releaseDir "releases.stable.json"
if (-not (Test-Path -LiteralPath $stableFeedPath -PathType Leaf)) {
  throw "Velopack stable release feed is missing"
}
$stableFeed = Get-Content -LiteralPath $stableFeedPath -Raw | ConvertFrom-Json
$feedAssets = @($stableFeed.Assets)
if ($feedAssets.Count -eq 0) {
  throw "Velopack stable release feed contains no assets"
}
foreach ($asset in $feedAssets) {
  $assetName = [string]$asset.FileName
  if ([string]::IsNullOrWhiteSpace($assetName) -or [IO.Path]::GetFileName($assetName) -ne $assetName) {
    throw "Velopack stable release feed contains an unsafe asset name: $assetName"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $releaseDir $assetName) -PathType Leaf)) {
    throw "Velopack stable release feed references a missing asset: $assetName"
  }
}
if (-not $fullOnlyBuild) {
  $currentDelta = @(Get-ChildItem -LiteralPath $releaseDir -Filter "*-$version-*-delta.nupkg" -File)
  if ($currentDelta.Count -ne 1) {
    throw "Expected exactly one current delta package, found $($currentDelta.Count)"
  }
}
Write-Host "BZ-Games Velopack release created at $releaseDir"
