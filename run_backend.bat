@echo off
setlocal enabledelayedexpansion

echo ==================================================
echo [INFO] MANGA TRANSLATOR SYSTEM LAUNCHER
echo ==================================================

:: 1. ตั้งชื่อไฟล์ลับสำหรับบันทึกสถานะการติดตั้ง
set "FLAG_FILE=%~dp0venv\install_complete_v2.flag"

:: 2. ตรวจสอบสถานะการดาวน์โหลดชุดใหม่
if exist "!FLAG_FILE!" (
    echo [STATUS] All dependencies are verified. Skipping installation...
    goto :RUN_SERVER
)

:INSTALL_DEPENDENCIES
echo [STATUS] Missing dependencies detected. Starting initial setup...
echo --------------------------------------------------

echo [1/3] Installing core web and image modules...
"%~dp0venv\Scripts\pip.exe" install fastapi uvicorn pillow pydantic opencv-python numpy pyyaml

echo [2/3] Installing compatible mathematical modules...
"%~dp0venv\Scripts\pip.exe" install "scipy<1.14.0"

echo [3/3] Installing EasyOCR & Deep Translator modules...
"%~dp0venv\Scripts\pip.exe" install easyocr --no-deps
"%~dp0venv\Scripts\pip.exe" install scikit-image shapely pyclipper python-bidi ninja
:: ⚡ [บรรทัดที่เพิ่มเข้ามา] สั่งดาวน์โหลดระบบแปลภาษาเข้าห้อง venv ตรงๆ
"%~dp0venv\Scripts\pip.exe" install deep-translator

:: สร้างไฟล์สัญลักษณ์ตัวใหม่ทิ้งไว้เมื่อสำเร็จ
echo. > "!FLAG_FILE!"
echo --------------------------------------------------
echo [SUCCESS] Initial setup finished completely!
echo --------------------------------------------------

:RUN_SERVER
echo [STATUS] Starting Manga Translator Backend with GPU (CUDA)...
echo.
:: ⚡ [ระบบเพิ่มความเสถียร] สั่งปิดโปรเซสตัวแปลภาษาหลังบ้านเก่าที่ค้างอยู่ในพอร์ต 8000 เพื่อป้องกันพอร์ตชนและโค้ดเก่าค้างคา
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000') do taskkill /f /pid %%a 2>nul
"%~dp0venv\Scripts\python.exe" "%~dp0manga-translator\backend\app.py"

pause