@echo off
title Mon copilote budget
cd /d "%~dp0"

if not exist node_modules (
  echo Installation des dependances, une seule fois...
  call npm.cmd install --no-audit --no-fund
)

rem Reconstruit seulement si le code a change depuis la derniere fois.
rem Sans ce test : soit on reconstruit a chaque lancement, soit on sert une
rem interface perimee apres un git pull, dist n'etant pas suivi par git.
node outils\besoin-build.mjs
if errorlevel 1 (
  echo Mise a jour de l'interface...
  call npm.cmd run build
)

echo.
echo Mon copilote budget demarre. Laissez cette fenetre ouverte.
echo Sur le PC : http://localhost:3001
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo Sur le telephone : http://%%a:3001
echo.
call npm.cmd start
pause
