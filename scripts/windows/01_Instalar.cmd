@echo off
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\setup-user.ps1" -Action Install
if errorlevel 1 (echo Installation failed. Check messages above.)
pause
