@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
if not exist "%SCRIPT_DIR%Start-DevicePreviewLab.exe" (
  echo Native launcher is missing. Run Build-DevicePreviewLabLauncher.ps1 once first.
  exit /b 1
)
start "" "%SCRIPT_DIR%Start-DevicePreviewLab.exe" %*
endlocal
exit /b 0
