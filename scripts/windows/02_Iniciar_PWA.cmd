@echo off
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\windows\setup-user.ps1" -Action Start
if errorlevel 1 (echo Unable to start. Run 01_Instalar.cmd first.)
pause
