param(
  [string]$TargetUrl = "http://127.0.0.1:8080",
  [int]$Port = 9090,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-AvailablePort([int]$StartPort) {
  $candidate = $StartPort
  while (Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue) {
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
if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
  throw "Missing server.js next to this launcher."
}

$node = (Get-Command node -ErrorAction Stop).Source
$resolvedPort = Get-AvailablePort $Port
$normalizedTargetUrl = Normalize-TargetUrl $TargetUrl
$encodedTargetUrl = [System.Uri]::EscapeDataString($normalizedTargetUrl)
$previewUrl = "http://127.0.0.1:$resolvedPort/?target=$encodedTargetUrl"
$healthUrl = "http://127.0.0.1:$resolvedPort/health"

$logDir = Join-Path $appRoot ".logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$serverOut = Join-Path $logDir "device-preview-lab.out.log"
$serverErr = Join-Path $logDir "device-preview-lab.err.log"
Remove-Item -LiteralPath $serverOut, $serverErr -ErrorAction SilentlyContinue

$previewServer = $null
$previousPortEnv = $env:PORT

try {
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

  Write-Host "Device Preview Lab is running."
  Write-Host "Preview URL: $previewUrl"
  Write-Host "Target URL:  $normalizedTargetUrl"
  Write-Host "Logs:        $logDir"
  Write-Host ""
  Write-Host "Open another app locally, paste its http or https URL into the Target URL field, and load previews."
  Write-Host "Press Ctrl+C in this PowerShell window to stop the preview server."

  if (-not $NoOpen) {
    Start-Process $previewUrl
  }

  while ($true) {
    if ($previewServer.HasExited) {
      throw "The device preview server stopped. See $serverErr"
    }
    Start-Sleep -Seconds 2
  }
} finally {
  $env:PORT = $previousPortEnv
  Stop-ChildProcess $previewServer
}
