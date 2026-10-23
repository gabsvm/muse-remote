@echo off
cd /d "%~dp0\..\.."
echo ADVERTENCIA: esta accion desconectara TODOS los telefonos emparejados.
echo Primero cerra todas las instancias del servidor Muse Remote.
set /p confirm=Escribi REVOCAR para continuar:
if not "%confirm%"=="REVOCAR" (echo Cancelado. & pause & exit /b 0)
node scripts\security\rotate-token.js --confirm-revoke-all
pause
