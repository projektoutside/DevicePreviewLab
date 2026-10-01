param(
  [string]$TargetUrl = "http://127.0.0.1:8080",
  [ValidateRange(1, 65535)]
  [int]$Port = 9090,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-AvailablePort([int]$StartPort) {
  $candidate = $StartPort
  while (Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue) {
    if ($candidate -eq 65535) {
      throw "No available preview port at or above $StartPort."
    }
    $candidate++
  }
  return $candidate
}

function Wait-ForHttp([string]$Url, [int]$TimeoutSeconds = 30) {
  for ($attempt = 0; $attempt -lt $TimeoutSeconds; $attempt++) {
    try {
      Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
      return
    } catch {
      Start-Sleep -Seconds 1
    }
  }

  throw "Timed out waiting for $Url"
}

function Stop-ChildProcess([System.Diagnostics.Process]$Process) {
  if ($null -ne $Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  }
}

function Get-AppBrowser {
  $browserCandidates = @(
    [pscustomobject]@{
      Name = "Google Chrome"
      Path = Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"
    },
    [pscustomobject]@{
      Name = "Google Chrome"
      Path = Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"
    },
    [pscustomobject]@{
      Name = "Google Chrome"
      Path = Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"
    },
    [pscustomobject]@{
      Name = "Microsoft Edge"
      Path = Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"
    },
    [pscustomobject]@{
      Name = "Microsoft Edge"
      Path = Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"
    },
    [pscustomobject]@{
      Name = "Microsoft Edge"
      Path = Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe"
    }
  )

  foreach ($browser in $browserCandidates) {
    if (Test-Path -LiteralPath $browser.Path -PathType Leaf) {
      return $browser
    }
  }

  throw "Device Preview Lab requires Microsoft Edge or Google Chrome to open its managed app window."
}

function New-AppBrowserProfile([string]$AppRoot, [int]$PreviewPort, [string]$BrowserName) {
  $browserKey = if ($BrowserName -eq "Google Chrome") { "chrome" } else { "edge" }
  $profileDirectory = Join-Path (Join-Path $AppRoot ".browser-profiles") "$browserKey-$PreviewPort"
  New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null
  return $profileDirectory
}

function Start-AppBrowser(
  [pscustomobject]$Browser,
  [string]$Url,
  [string]$ProfileDirectory
) {
  $browserArguments = @(
    "--app=$Url",
    "--user-data-dir=`"$ProfileDirectory`"",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
    "--disable-extensions",
    "--disable-session-crashed-bubble",
    "--disable-features=msEdgeFirstRunExperience"
  )

  return Start-Process `
    -FilePath $Browser.Path `
    -ArgumentList $browserArguments `
    -WorkingDirectory (Split-Path -Parent $Browser.Path) `
    -PassThru
}

function Initialize-NativeWindowTracking {
  if ($null -ne ("DevicePreviewLab.NativeWindow" -as [type])) {
    return
  }

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace DevicePreviewLab
{
    public static class NativeWindow
    {
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsWindow(IntPtr windowHandle);
    }
}
'@
}

function Wait-ForBrowserWindowHandle(
  [System.Diagnostics.Process]$Process,
  [int]$TimeoutSeconds = 15
) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($Process.HasExited) {
      throw "The browser exited before its Device Preview Lab window opened."
    }

    $Process.Refresh()
    if ($Process.MainWindowHandle -ne [IntPtr]::Zero) {
      return $Process.MainWindowHandle
    }

    Start-Sleep -Milliseconds 100
  }

  throw "Timed out waiting for the Device Preview Lab browser window."
}

function Write-LauncherLog([string]$Path, [string]$Message) {
  $timestamp = [DateTimeOffset]::Now.ToString("o")
  Add-Content -LiteralPath $Path -Value "$timestamp $Message" -Encoding UTF8
}

function Normalize-TargetUrl([string]$RawUrl) {
  if ([string]::IsNullOrWhiteSpace($RawUrl)) {
    throw "TargetUrl cannot be empty."
  }

  $candidate = $RawUrl.Trim()
  $uri = $null
  if (-not [System.Uri]::TryCreate($candidate, [System.UriKind]::Absolute, [ref]$uri)) {
    throw "TargetUrl must be an absolute http or https URL."
  }

  if ($uri.Scheme -ne "http" -and $uri.Scheme -ne "https") {
    throw "TargetUrl must use http or https."
  }

  return $uri.AbsoluteUri
}

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverScript = Join-Path $appRoot "server.js"
$requiredFiles = @("server.js", "index.html", "app.js", "styles.css", "local-server-discovery.js", "terminal-service.js", "terminal-hall.js", "Select-DevicePreviewFolder.exe")
foreach ($requiredFile in $requiredFiles) {
  $requiredPath = Join-Path $appRoot $requiredFile
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Missing $requiredFile next to this launcher. Expected: $requiredPath"
  }
}

$node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules\node-pty\package.json'))) {
  throw 'Terminal Hall dependencies are missing. Run npm ci in the DevicePreviewLab folder, then reopen the app.'
}
$logDir = Join-Path $appRoot ".logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$serverOut = Join-Path $logDir "device-preview-lab-$PID.out.log"
$serverErr = Join-Path $logDir "device-preview-lab-$PID.err.log"
$launcherLog = Join-Path $logDir "device-preview-lab-launcher.log"
Remove-Item -LiteralPath $serverOut, $serverErr -ErrorAction SilentlyContinue

$resolvedPort = Get-AvailablePort $Port
if ($resolvedPort -ne $Port) {
  Write-Host "Port $Port is busy, using $resolvedPort instead."
  Write-LauncherLog $launcherLog "Requested port $Port is busy. Using $resolvedPort."
}
$normalizedTargetUrl = Normalize-TargetUrl $TargetUrl
$encodedTargetUrl = [System.Uri]::EscapeDataString($normalizedTargetUrl)
$previewUrl = "http://127.0.0.1:$resolvedPort/"
if ($PSBoundParameters.ContainsKey('TargetUrl')) {
  $previewUrl += "?target=$encodedTargetUrl"
}
$healthUrl = "http://127.0.0.1:$resolvedPort/health"
$localServersUrl = "http://127.0.0.1:$resolvedPort/api/local-servers"

$previewServer = $null
$browserProcess = $null
$browserWindowHandle = [IntPtr]::Zero
$browserProfileDirectory = $null
$previousPortEnv = $env:PORT

try {
  Write-LauncherLog $launcherLog "Starting Device Preview Lab on port $resolvedPort."
  $env:PORT = "$resolvedPort"
  $previewServer = Start-Process `
    -FilePath $node `
    -ArgumentList @("server.js") `
    -WorkingDirectory $appRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $serverOut `
    -RedirectStandardError $serverErr `
    -PassThru
  $env:PORT = $previousPortEnv

  Wait-ForHttp $healthUrl

  try {
    $scanResponse = Invoke-WebRequest -Uri $localServersUrl -UseBasicParsing -TimeoutSec 10
    $scanPayload = $scanResponse.Content | ConvertFrom-Json
    $detectedCount = @($scanPayload.servers).Count
    Write-LauncherLog $launcherLog "Local-server scan ready. Detected $detectedCount server(s)."
  } catch {
    Write-LauncherLog $launcherLog "Local-server scan check skipped: $($_.Exception.Message)"
  }

  Write-Host "Device Preview Lab is running."
  Write-Host "Preview URL: $previewUrl"
  Write-Host "Target URL:  $normalizedTargetUrl"
  Write-Host "Scan API:    $localServersUrl"
  Write-Host "Logs:        $logDir"
  Write-Host ""
  Write-Host "Pick a running server from the Detect dropdown, or paste any http or https URL into the Target URL field."

  if ($NoOpen) {
    Write-Host "Press Ctrl+C in this PowerShell window to stop the preview server."
    while ($true) {
      if ($previewServer.HasExited) {
        throw "The device preview server stopped. See $serverErr"
      }
      Start-Sleep -Seconds 2
    }
  } else {
    $browser = Get-AppBrowser
    $browserProfileDirectory = New-AppBrowserProfile $appRoot $resolvedPort $browser.Name
    $browserProcess = Start-AppBrowser `
      -Browser $browser `
      -Url $previewUrl `
      -ProfileDirectory $browserProfileDirectory
    Initialize-NativeWindowTracking
    $browserWindowHandle = Wait-ForBrowserWindowHandle $browserProcess
    Write-LauncherLog $launcherLog (
      "Opened {0} app window. BrowserPid={1}; WindowHandle={2}; Profile={3}; PreviewUrl={4}" -f `
        $browser.Name,
        $browserProcess.Id,
        $browserWindowHandle,
        $browserProfileDirectory,
        $previewUrl
    )

    while (
      -not $browserProcess.HasExited -and
      [DevicePreviewLab.NativeWindow]::IsWindow($browserWindowHandle)
    ) {
      if ($previewServer.HasExited) {
        throw "The device preview server stopped. See $serverErr"
      }
      Start-Sleep -Milliseconds 500
    }

    Write-LauncherLog $launcherLog "Browser app window closed. Stopping the preview server."
  }
} catch {
  Write-LauncherLog $launcherLog "Launcher error: $($_.Exception.Message)"
  throw
} finally {
  $env:PORT = $previousPortEnv
  Stop-ChildProcess $browserProcess
  Stop-ChildProcess $previewServer
  Write-LauncherLog $launcherLog "Device Preview Lab session stopped."
}
