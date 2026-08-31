param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^http://[^/]+(?::\d+)?$')]
  [string]$PublicBaseUrl,
  [string]$Token,
  [string]$TokenOutputPath
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repoRoot "private-build.config.json"
$targetPath = Join-Path $repoRoot "private-build.config.test.json"
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Production private build config is missing"
}
if ([string]::IsNullOrWhiteSpace($Token)) {
  $bytes = [byte[]]::new(32)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  $Token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
if ($Token -notmatch '^[A-Za-z0-9_-]{43}$') {
  throw "Test channel token must be 32 random bytes encoded as unpadded Base64URL"
}
$config = Get-Content -LiteralPath $sourcePath -Raw | ConvertFrom-Json
$config.updateFeedUrl = "$PublicBaseUrl/api/v1/desktop-updates/test/$Token"
$config.previousReleaseFeedUrl = $config.updateFeedUrl
$json = $config | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText($targetPath, "$json`n", [Text.UTF8Encoding]::new($false))
if (-not [string]::IsNullOrWhiteSpace($TokenOutputPath)) {
  $resolvedTokenPath = if ([IO.Path]::IsPathRooted($TokenOutputPath)) {
    [IO.Path]::GetFullPath($TokenOutputPath)
  } else {
    [IO.Path]::GetFullPath((Join-Path $repoRoot $TokenOutputPath))
  }
  $runtimeRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot ".runtime"))
  if (-not $resolvedTokenPath.StartsWith("$runtimeRoot$([IO.Path]::DirectorySeparatorChar)", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Token output must be inside the ignored .runtime directory"
  }
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($resolvedTokenPath)) | Out-Null
  [IO.File]::WriteAllText($resolvedTokenPath, $Token, [Text.UTF8Encoding]::new($false))
}
Write-Host "Test private config created without exposing its token"
