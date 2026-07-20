@echo off
title Manga Translator Backend Server

echo ==================================================
echo [INFO] MANGA TRANSLATOR SYSTEM LAUNCHER
echo ==================================================

REM 1. Check Python installation
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] Python is not found in system PATH.
    echo [STATUS] Downloading Python 3.11 installer
    curl -L -o "%temp%\python_installer.exe" https://www.python.org/ftp/python/3.11.8/python-3.11.8-amd64.exe
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to download Python. Please install Python 3.10+ from python.org
        pause
        exit /b 1
    )
    echo [STATUS] Installing Python 3.11
    "%temp%\python_installer.exe" /quiet InstallAllUsers=1 PrependPath=1 Include_test=0
    del "%temp%\python_installer.exe"
)

REM 2. Check Virtual Environment
set VENV_DIR=%~dp0venv
if not exist "%VENV_DIR%\Scripts\python.exe" (
    set VENV_DIR=%~dp0..\venv
)

if not exist "%VENV_DIR%\Scripts\python.exe" (
    echo [STATUS] Creating Python virtual environment
    python -m venv "%~dp0venv"
    set VENV_DIR=%~dp0venv
)

set PYTHON_EXE=%VENV_DIR%\Scripts\python.exe

if not exist "%PYTHON_EXE%" (
    echo [ERROR] Python virtual environment executable not found: "%PYTHON_EXE%"
    pause
    exit /b 1
)

REM 3. Locate backend/app.py
set APP_PATH=%~dp0backend\app.py
if not exist "%APP_PATH%" (
    set APP_PATH=%~dp0manga-translator\backend\app.py
)

if not exist "%APP_PATH%" (
    echo [ERROR] Could not locate backend/app.py script!
    pause
    exit /b 1
)

echo [STATUS] Starting Manga Translator Backend Server
echo [INFO] Python Path: "%PYTHON_EXE%"
echo [INFO] App Path:    "%APP_PATH%"
echo.

"%PYTHON_EXE%" "%APP_PATH%"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Backend server exited with error code %errorlevel%
)
pause
