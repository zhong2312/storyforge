@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\portable-builder\build-portable.ps1" -SourceRoot "%~dp0" -OutputRoot "%CD%"
if errorlevel 1 (
  echo.
  echo Build failed. See the error above.
  pause
  exit /b 1
)
echo.
echo StoryForge-Windows-Portable.exe was created in:
echo %CD%
pause
