@echo off
rem pi-foundry launcher for Windows: forwards to scripts\pi-foundry.ps1
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pi-foundry.ps1" %*
exit /b %ERRORLEVEL%
