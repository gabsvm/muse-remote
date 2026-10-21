@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0muse-control.ps1" -Action Status
set "MUSE_RESULT=%ERRORLEVEL%"
echo.
if not "%MUSE_RESULT%"=="0" echo [ERROR] Revisa el mensaje anterior; no se modifico tu token ni certificado.
echo Presiona una tecla para cerrar esta ventana...
pause >nul
exit /b %MUSE_RESULT%
