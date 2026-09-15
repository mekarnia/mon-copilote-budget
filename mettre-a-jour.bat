@echo off
title Mon copilote budget - mise a jour
cd /d "%~dp0"

echo Recuperation de la derniere version...
git pull
if errorlevel 1 (
  echo.
  echo La mise a jour a echoue. Verifiez votre connexion, puis relancez ce fichier.
  pause
  exit /b 1
)

echo.
echo Version a jour. Demarrage...
echo.
call "%~dp0demarrer.bat"
