param([string]$LauncherPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'Start-DevicePreviewLab.exe'))

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$appRoot = Split-Path -Parent $PSScriptRoot
$nativeLauncher = [System.IO.Path]::GetFullPath($LauncherPath)
if (-not (Test-Path -LiteralPath $nativeLauncher)) { throw 'Build the native launcher before running this check.' }

$binary = [System.IO.File]::ReadAllBytes($nativeLauncher)
$peOffset = [BitConverter]::ToInt32($binary, 0x3c)
$subsystem = [BitConverter]::ToUInt16($binary, $peOffset + 24 + 68)
if ($subsystem -ne 2) { throw 'The launcher must use the Windows GUI subsystem, not the console subsystem.' }
Write-Host 'PASS: native launcher is a Windows GUI executable'

$assembly = [Reflection.Assembly]::LoadFile($nativeLauncher)
$quote = $assembly.GetType('DevicePreviewLab.Program').GetMethod('QuoteArgument', [Reflection.BindingFlags]'Static,NonPublic')
$fixtureValue = 'spaces, embedded "quotes", and a trailing backslash\'

foreach ($shutdownMode in @('normal', 'forced')) {
  $fixtureRoot = Join-Path (Join-Path $appRoot '.logs') "native-launcher-test-$([Guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
  $fixtureLauncher = Join-Path $fixtureRoot 'Start-DevicePreviewLab.exe'
  Copy-Item -LiteralPath $nativeLauncher -Destination $fixtureLauncher
  $fixtureScript = @'
param([string]$TestValue)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ConsoleProbe {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
}
"@
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = (Get-Command node -ErrorAction Stop).Source
$start.Arguments = '-e "setInterval(() => {}, 1000)"'
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$child = [System.Diagnostics.Process]::Start($start)
@{ SupervisorPid = $PID; ChildPid = $child.Id; ConsoleHandle = [ConsoleProbe]::GetConsoleWindow().ToInt64(); Value = $TestValue } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'proof.json')
while (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'stop'))) { Start-Sleep -Milliseconds 100 }
'@
  Set-Content -LiteralPath (Join-Path $fixtureRoot 'Start-DevicePreviewLab.ps1') -Value $fixtureScript
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $fixtureLauncher
  $start.WorkingDirectory = $fixtureRoot
  $start.Arguments = '-TestValue ' + $quote.Invoke($null, @($fixtureValue))
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $launcher = [System.Diagnostics.Process]::Start($start)
  try {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    $proofPath = Join-Path $fixtureRoot 'proof.json'
    while (-not (Test-Path -LiteralPath $proofPath)) {
      if ($launcher.HasExited -or [DateTime]::UtcNow -ge $deadline) { throw "Fixture failed to start: $shutdownMode" }
      Start-Sleep -Milliseconds 100
    }
    # Wait for the completed JSON write, not just file creation.
    $proof = $null
    while ($null -eq $proof) {
      try { $proof = Get-Content -LiteralPath $proofPath -Raw | ConvertFrom-Json } catch {}
      if ([DateTime]::UtcNow -ge $deadline) { throw 'Fixture proof was not completed.' }
      if ($null -eq $proof) { Start-Sleep -Milliseconds 100 }
    }
    if ($proof.ConsoleHandle -ne 0) { throw 'PowerShell has an allocated console.' }
    if ($proof.Value -cne $fixtureValue) { throw 'Argument quoting changed the forwarded value.' }
    $supervisor = Get-Process -Id $proof.SupervisorPid
    $child = Get-Process -Id $proof.ChildPid
    if ($shutdownMode -eq 'normal') {
      Set-Content -LiteralPath (Join-Path $fixtureRoot 'stop') -Value 'stop'
      if (-not $launcher.WaitForExit(10000) -or $launcher.ExitCode -ne 0) { throw 'Native launcher did not exit normally.' }
    } else {
      $launcher.Kill()
      if (-not $launcher.WaitForExit(10000)) { throw 'Native launcher did not terminate.' }
    }
    if (-not $supervisor.WaitForExit(10000) -or -not $child.WaitForExit(10000)) { throw 'Owned processes were left running.' }
    Write-Host "PASS: $shutdownMode exit; no PowerShell console; arguments preserved; supervisor and child both stopped"
  } finally {
    if (-not $launcher.HasExited) { $launcher.Kill(); $launcher.WaitForExit() }
    $launcher.Dispose()
  }
}
