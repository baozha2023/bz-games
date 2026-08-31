param(
  [switch]$FullOnly,
  [switch]$Test,
  [ValidatePattern('^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')]
  [string]$TestVersion
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$packageVersion = (Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json).version
if ($Test -and [string]::IsNullOrWhiteSpace($TestVersion)) {
  throw "Test builds require -TestVersion <stable-semver>"
}
if (-not $Test -and -not [string]::IsNullOrWhiteSpace($TestVersion)) {
  throw "-TestVersion is only valid with -Test"
}
$version = if ($Test) { $TestVersion } else { $packageVersion }
if ($version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
  throw "Build version must be a stable SemVer"
}
$versionParts = $version.Split('.')
foreach ($versionPart in $versionParts) {
  $parsedVersionPart = 0L
  if (-not [Int64]::TryParse($versionPart, [ref]$parsedVersionPart) -or $parsedVersionPart -lt 0 -or $parsedVersionPart -gt 9007199254740991L) {
    throw "Version components must be safe non-negative integers"
  }
}
$privateConfigFile = if ($Test) { "private-build.config.test.json" } else { "private-build.config.json" }
$privateConfigPath = Join-Path $repoRoot $privateConfigFile
if (-not (Test-Path -LiteralPath $privateConfigPath -PathType Leaf)) {
  throw "Private build config is missing: $privateConfigPath"
}
$privateConfig = Get-Content -LiteralPath $privateConfigPath -Raw | ConvertFrom-Json
$updateFeedUrl = [string]$privateConfig.updateFeedUrl
$previousReleaseFeedUrl = [string]$privateConfig.previousReleaseFeedUrl
foreach ($feedEntry in @(@("updateFeedUrl", $updateFeedUrl), @("previousReleaseFeedUrl", $previousReleaseFeedUrl))) {
  $parsedFeedUri = $null
  if (-not [Uri]::TryCreate($feedEntry[1], [UriKind]::Absolute, [ref]$parsedFeedUri) -or $parsedFeedUri.Scheme -notin @("http", "https")) {
    throw "$privateConfigFile must define $($feedEntry[0]) as an absolute HTTP(S) URL"
  }
  if (-not [string]::IsNullOrEmpty($parsedFeedUri.UserInfo) -or -not [string]::IsNullOrEmpty($parsedFeedUri.Query) -or -not [string]::IsNullOrEmpty($parsedFeedUri.Fragment)) {
    throw "$privateConfigFile $($feedEntry[0]) must not contain user info, a query, or a fragment"
  }
}
$updateFeedUri = [Uri]$updateFeedUrl
$previousReleaseFeedUri = [Uri]$previousReleaseFeedUrl
if ($Test) {
  $normalizedUpdateFeedUrl = $updateFeedUri.AbsoluteUri.TrimEnd('/')
  $normalizedPreviousReleaseFeedUrl = $previousReleaseFeedUri.AbsoluteUri.TrimEnd('/')
  if (
    $updateFeedUri.Scheme -ne 'http' -or
    $updateFeedUri.AbsolutePath -notmatch '^/api/v1/desktop-updates/test/[A-Za-z0-9_-]{43}/?$' -or
    $normalizedUpdateFeedUrl -cne $normalizedPreviousReleaseFeedUrl
  ) {
    throw "Test builds must use the same private HTTP test feed for runtime updates and the previous-test delta baseline"
  }
} else {
  $isGitHubFeed = {
    param([Uri]$Uri)
    $Uri.Scheme -eq 'https' -and
    $Uri.Host -eq 'github.com' -and
    $Uri.AbsolutePath.TrimEnd('/') -eq '/baozha2023/bz-games/releases/latest/download'
  }
  if (-not (& $isGitHubFeed $updateFeedUri) -or -not (& $isGitHubFeed $previousReleaseFeedUri)) {
    throw "Production builds must use the official GitHub latest-release URL for updates and the delta baseline"
  }
}
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
$releaseDir = if ($Test) {
  Join-Path $repoRoot "dist\velopack-test\$version"
} else {
  Join-Path $repoRoot "dist\velopack"
}
$launcher = Join-Path $repoRoot "native\bootstrap\target\release\bz-games-launcher.exe"
$uninstaller = Join-Path $repoRoot "native\bootstrap\target\release\bz-games-uninstaller.exe"
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
$env:BZ_PRIVATE_BUILD_CONFIG = $privateConfigFile

# GitHub Release downloads are frequently unreachable from the development
# network. Keep caller-provided mirrors authoritative, but provide reliable
# defaults for both Electron and electron-builder toolsets. Both download
# paths retain their upstream checksum verification.
if ([string]::IsNullOrWhiteSpace($env:ELECTRON_MIRROR)) {
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
}
if ([string]::IsNullOrWhiteSpace($env:ELECTRON_BUILDER_BINARIES_MIRROR)) {
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
}

& $cargo build --release --manifest-path $nativeManifest --bin bz-games-launcher
if ($LASTEXITCODE -ne 0) { throw "Root launcher build failed" }
& $cargo build --release --manifest-path $nativeManifest --bin bz-games-uninstaller
if ($LASTEXITCODE -ne 0) { throw "Root uninstaller build failed" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "Electron Windows package build failed" }
npx electron-builder --win --dir "--config.extraMetadata.version=$version"
if ($LASTEXITCODE -ne 0) { throw "Electron Windows package packaging failed" }

if (Test-Path -LiteralPath $releaseDir) {
  Remove-Item -LiteralPath $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

if (-not $fullOnlyBuild) {
  $downloadArgs = @(
    "download", "http",
    "--url", $previousReleaseFeedUrl,
    "--channel", "stable",
    "--outputDir", $releaseDir
  )
  & $vpk @downloadArgs
  if ($LASTEXITCODE -ne 0) {
    $baselineChannel = if ($Test) { "test" } else { "production" }
    throw "Unable to download the previous $baselineChannel Velopack release from $previousReleaseFeedUrl"
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

# Keep the output directory identical to the server's atomic release bundle.
# Velopack also emits legacy feeds and its generic setup executable; the custom
# BZ-Games installer supersedes those files and they must not be uploaded.
$bundleFiles = [Collections.Generic.HashSet[string]]::new(
  [StringComparer]::Ordinal
)
[void]$bundleFiles.Add((Split-Path -Leaf $finalInstaller))
[void]$bundleFiles.Add((Split-Path -Leaf $stableFeedPath))
foreach ($asset in $feedAssets) {
  [void]$bundleFiles.Add([string]$asset.FileName)
}
foreach ($generatedFile in Get-ChildItem -LiteralPath $releaseDir -File) {
  if (-not $bundleFiles.Contains($generatedFile.Name)) {
    Remove-Item -LiteralPath $generatedFile.FullName -Force
  }
}
$remainingFiles = @(Get-ChildItem -LiteralPath $releaseDir -File)
$unexpectedFiles = @(
  $remainingFiles | Where-Object { -not $bundleFiles.Contains($_.Name) }
)
if (
  $remainingFiles.Count -ne $bundleFiles.Count -or
  $unexpectedFiles.Count -ne 0
) {
  throw "Release output does not match the validated atomic bundle"
}
Write-Host "BZ-Games Velopack release created at $releaseDir"
