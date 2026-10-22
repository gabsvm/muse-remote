@echo off
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\setup-user.ps1" -Action Doctor
pause
