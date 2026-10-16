@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0..\.."
set "MUSE_REMOTE_LAN=1"
set "MUSE_REMOTE_PORT=8787"
title Muse Remote - Servidor LAN y Tailscale
echo === MUSE REMOTE - SERVIDOR (mantener abierta) ===
echo Local: http://127.0.0.1:8787
echo LAN HTTPS: 8788 - Remoto por Tailscale Serve existente
echo Para detenerlo, Ctrl+C o el acceso de reinicio.
echo.
node server.js
echo.
echo El servidor se ha detenido. Consulta los errores anteriores.
pause
