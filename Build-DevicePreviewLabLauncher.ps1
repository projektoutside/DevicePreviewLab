param([string]$OutputPath = (Join-Path $PSScriptRoot 'Start-DevicePreviewLab.exe'))

$ErrorActionPreference = 'Stop'
$compilerCandidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw 'The Windows .NET Framework C# compiler is unavailable.' }
$launcherOutput = [System.IO.Path]::GetFullPath($OutputPath)
$launcherSource = Join-Path $PSScriptRoot 'launcher\Program.cs'
& $compiler /nologo /warnaserror+ /target:winexe /optimize+ /platform:anycpu "/out:$launcherOutput" $launcherSource
if ($LASTEXITCODE -ne 0) { throw 'Native launcher compilation failed.' }
Write-Host "Built console-free launcher: $launcherOutput"
$pickerOutput = Join-Path (Split-Path -Parent $launcherOutput) 'Select-DevicePreviewFolder.exe'
& $compiler /nologo /warnaserror+ /target:winexe /optimize+ /platform:anycpu "/out:$pickerOutput" (Join-Path $PSScriptRoot 'launcher\FolderPicker.cs')
if ($LASTEXITCODE -ne 0) { throw 'Folder picker compilation failed.' }
Write-Host "Built native folder picker: $pickerOutput"
