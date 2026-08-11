@echo off
rem Cheremsha: Goshype - launcher for Windows.
rem Keep this file ASCII-only: cmd.exe reads .bat in the OEM codepage.
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 server\app.py %*
    exit /b
)

where python >nul 2>nul
if %errorlevel%==0 (
    python server\app.py %*
    exit /b
)

echo Python 3.9+ not found. Install it from https://python.org and try again.
pause
