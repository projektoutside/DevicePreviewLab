param(
    [Parameter(Mandatory = $true)][string]$ProjectPath,
    [string]$BackupDirectory
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($BackupDirectory)) {
    $BackupDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) '.logs\flutter-bootstrap-backups'
}
$projectRoot = (Resolve-Path -LiteralPath $ProjectPath).Path
$webRoot = Join-Path $projectRoot 'web'
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'pubspec.yaml')) -or -not (Test-Path -LiteralPath $webRoot -PathType Container)) {
    throw 'Choose a Flutter project with pubspec.yaml and a web directory.'
}
$bootstrapPath = Join-Path $webRoot 'flutter_bootstrap.js'
$exists = Test-Path -LiteralPath $bootstrapPath -PathType Leaf
$original = if ($exists) { [System.IO.File]::ReadAllText($bootstrapPath) } else { "{{flutter_js}}`n{{flutter_build_config}}`n`n_flutter.loader.load();`n" }
$lineEnding = if ($original.Contains("`r`n")) { "`r`n" } else { "`n" }
$begin = '// BEGIN DEVICE PREVIEW LAB STARTUP'
$end = '// END DEVICE PREVIEW LAB STARTUP'
$helperPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'integrations\flutter-preview-startup.js'
$helper = [System.IO.File]::ReadAllText($helperPath).Replace("`r`n", "`n").TrimEnd().Replace("`n", $lineEnding)
$block = "$begin$lineEnding$helper$lineEnding$end$lineEnding"
$beginIndex = $original.IndexOf($begin)
$endIndex = $original.IndexOf($end)
if ($beginIndex -ge 0 -or $endIndex -ge 0) {
    if ($beginIndex -lt 0 -or $endIndex -lt $beginIndex -or $original.LastIndexOf($begin) -ne $beginIndex -or $original.LastIndexOf($end) -ne $endIndex) {
        throw 'The existing preview startup block is incomplete or duplicated; no files were changed.'
    }
    $afterBlock = $endIndex + $end.Length
    if ($original.Substring($afterBlock).StartsWith($lineEnding)) { $afterBlock += $lineEnding.Length }
    $updated = $original.Substring(0, $beginIndex) + $block + $original.Substring($afterBlock)
} else {
    $load = '_flutter.loader.load();'
    $loadIndex = $original.IndexOf($load)
    if ($loadIndex -lt 0 -or $original.LastIndexOf($load) -ne $loadIndex) {
        throw 'A single default Flutter loader call is required; no files were changed.'
    }
    $updated = $original.Insert($loadIndex, "$block$lineEnding")
}
if ($exists -and $updated -eq $original) {
    Write-Host "Preview compatibility is already current: $bootstrapPath"
    return
}
if ($exists) {
    New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
    $backupPath = Join-Path $BackupDirectory ((Split-Path $projectRoot -Leaf) + '-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff') + '.js')
    [System.IO.File]::WriteAllBytes($backupPath, [System.IO.File]::ReadAllBytes($bootstrapPath))
    Write-Host "Original bootstrap saved: $backupPath"
}
[System.IO.File]::WriteAllText($bootstrapPath, $updated, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Enabled local Flutter preview startup: $bootstrapPath"
