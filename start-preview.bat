@echo off
title Solar Voyager - Local Preview
cd /d "C:\Users\86159\Desktop\solar-voyager"

set PY=C:\Users\86159\.workbuddy\binaries\python\versions\3.13.12\python.exe
if not exist "%PY%" set PY=D:\LX\python\python.exe
if not exist "%PY%" set PY=python

set PROBE="%PY%" -c "import socket;s=socket.create_connection(('127.0.0.1',8765),2);s.close()"

REM ---- is a server already listening? (retry 3 times) ----
%PROBE% >nul 2>&1
if %errorlevel%==0 goto RUNNING
ping -n 2 127.0.0.1 >nul
%PROBE% >nul 2>&1
if %errorlevel%==0 goto RUNNING
ping -n 2 127.0.0.1 >nul
%PROBE% >nul 2>&1
if %errorlevel%==0 goto RUNNING

echo [..] Starting preview server on port 8765 ...
echo.
echo     KEEP THIS WINDOW OPEN while browsing.
echo     To STOP the server: press Ctrl+C, or just close this window.
echo.
start "" http://127.0.0.1:8765/index.html
"%PY%" -m http.server 8765 --bind 127.0.0.1
echo.
echo [x] Server stopped.
pause
exit /b

:RUNNING
echo [OK] Server is already running - opening browser only.
start "" http://127.0.0.1:8765/index.html
echo     Nothing new was started. Close this window freely.
ping -n 6 127.0.0.1 >nul
