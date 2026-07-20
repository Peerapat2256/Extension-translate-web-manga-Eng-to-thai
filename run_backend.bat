@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ==================================================
echo [INFO] MANGA TRANSLATOR SYSTEM LAUNCHER
echo ==================================================

REM 1. Check if Python is installed
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [WARNING] ไม่พบ Python ติดตั้งอยู่ในเครื่องระบบของคุณ!
    echo [STATUS] กำลังดาวน์โหลดตัวติดตั้ง Python 3.11.8...
    curl -L -o "%temp%\python_installer.exe" https://www.python.org/ftp/python/3.11.8/python-3.11.8-amd64.exe
    if %errorlevel% neq 0 (
        echo [ERROR] ไม่สามารถดาวน์โหลด Python ได้ กรุณาติดตั้ง Python 3.10+ ด้วยตนเองจากเว็บ python.org
        pause
        exit /b
    )
    echo [STATUS] กำลังติดตั้ง Python แบบเงียบ (กรุณากดตกลงสิทธิ์ Admin หากหน้าต่างแจ้งเตือนขึ้น)...
    "%temp%\python_installer.exe" /quiet InstallAllUsers=1 PrependPath=1 Include_test=0
    del "%temp%\python_installer.exe"
    
    set "PATH=%PATH%;%ProgramFiles%\Python311;%ProgramFiles%\Python311\Scripts;%LocalAppData%\Programs\Python\Python311;%LocalAppData%\Programs\Python\Python311\Scripts"
    
    where python >nul 2>nul
    if %errorlevel% neq 0 (
        echo [ERROR] ติดตั้ง Python สำเร็จแล้วแต่ยังไม่พบในระบบ PATH กรุณาเปิดรันตัวนี้ใหม่อีกครั้ง
        pause
        exit /b
    )
    echo [SUCCESS] ติดตั้ง Python เรียบร้อยแล้ว!
) else (
    echo [STATUS] พบ Python ในระบบเรียบร้อย
)

REM 2. Check and create Python Virtual Environment (venv)
if not exist "%~dp0venv" (
    echo [STATUS] กำลังสร้างสภาพแวดล้อมจำลอง venv...
    python -m venv "%~dp0venv"
    if %errorlevel% neq 0 (
        echo [ERROR] สร้าง venv ล้มเหลว กรุณาลง python-venv
        pause
        exit /b
    )
    echo [SUCCESS] สร้าง venv สำเร็จ
)

REM 3. Define installation completion flag file path
set "FLAG_FILE=%~dp0venv\install_complete_v3.flag"

REM 4. Check if libraries have already been installed
if exist "!FLAG_FILE!" (
    echo [STATUS] ตรวจสอบระบบเรียบร้อยแล้ว ข้ามการติดตั้งไลบรารี...
    goto :RUN_SERVER
)

echo.
echo ==================================================
echo [STATUS] ตรวจพบคลิกการติดตั้งครั้งแรก กำลังเริ่มติดตั้งไลบรารีพื้นฐาน...
echo ==================================================
echo.

echo [1/3] กำลังติดตั้ง Web Module และ Image Module หลัก...
"%~dp0venv\Scripts\pip.exe" install fastapi uvicorn pillow pydantic opencv-python numpy pyyaml deep-translator pythainlp

echo [2/3] กำลังติดตั้งโมดูลคณิตศาสตร์ร่วม...
"%~dp0venv\Scripts\pip.exe" install "scipy<1.14.0"

echo [3/3] กำลังติดตั้งโมดูลตรวจจับข้อความและแปลภาษา...
"%~dp0venv\Scripts\pip.exe" install easyocr --no-deps
"%~dp0venv\Scripts\pip.exe" install scikit-image shapely pyclipper python-bidi ninja

REM Verify if GPU is available to install the correct PaddlePaddle package
"%~dp0venv\Scripts\python.exe" -c "import torch; print(torch.cuda.is_available())" | findstr "True" >nul
if %errorlevel% == 0 (
    echo [INFO] ตรวจพบการ์ดจอที่รองรับ CUDA กำลังลงทะเบียนรุ่น GPU สำหรับ Paddle...
    "%~dp0venv\Scripts\pip.exe" install paddlepaddle-gpu
) else (
    echo [INFO] ไม่พบการ์ดจอ CUDA กำลังติดตั้งรุ่น CPU สำหรับ Paddle...
    "%~dp0venv\Scripts\pip.exe" install paddlepaddle
)
"%~dp0venv\Scripts\pip.exe" install paddleocr

echo.
echo ==================================================
echo [ขั้นตอนการดาวน์โหลดโมเดลระบบ (Model Installation)]
echo ==================================================
echo.

:OCR_MODEL_MENU
echo คุณต้องการดาวน์โหลดโมเดล OCR ตัวตรวจข้อความรุ่นใดบ้าง?
echo (การพรีดาวน์โหลดจะช่วยให้ไม่ต้องรอนานขณะกดแปลรูปหน้าแรก)
echo [1] ดาวน์โหลดโมเดล EasyOCR (อังกฤษ + เกาหลี)
echo [2] ดาวน์โหลดโมเดล PaddleOCR (อังกฤษ + เกาหลี)
echo [3] ดาวน์โหลดทั้งคู่ (แนะนำ - เพื่อประสิทธิภาพสูงสุด)
echo [4] ข้ามขั้นตอนนี้ไปก่อน (จะโหลดอัตโนมัติเมื่อกดแปลครั้งแรก)
echo.
set /p OCR_CHOICE="กรอกตัวเลือก (1-4) [ค่าเริ่มต้น 3]: "
if "!OCR_CHOICE!"=="" set OCR_CHOICE=3

if "!OCR_CHOICE!"=="1" (
    echo กำลังพรีโหลด EasyOCR Models...
    "%~dp0venv\Scripts\python.exe" -c "import easyocr; print('Loading English...'); easyocr.Reader(['en'], gpu=True); print('Loading Korean...'); easyocr.Reader(['ko','en'], gpu=True)"
)
if "!OCR_CHOICE!"=="2" (
    echo กำลังพรีโหลด PaddleOCR Models...
    "%~dp0venv\Scripts\python.exe" -c "from paddleocr import PaddleOCR; print('Loading English...'); PaddleOCR(lang='en'); print('Loading Korean...'); PaddleOCR(lang='korean')"
)
if "!OCR_CHOICE!"=="3" (
    echo กำลังพรีโหลดโมเดล OCR ทั้งคู่...
    "%~dp0venv\Scripts\python.exe" -c "import easyocr; print('Loading EasyOCR...'); easyocr.Reader(['en'], gpu=True); easyocr.Reader(['ko','en'], gpu=True)"
    "%~dp0venv\Scripts\python.exe" -c "from paddleocr import PaddleOCR; print('Loading PaddleOCR...'); PaddleOCR(lang='en'); PaddleOCR(lang='korean')"
)
if "!OCR_CHOICE!"=="4" (
    echo ข้ามการพรีโหลดโมเดล OCR...
)

echo.
echo --------------------------------------------------
:OLLAMA_MENU
echo คุณต้องการดาวน์โหลดตัวแปลภาษาออฟไลน์ Local AI (Ollama) ในขั้นตอนนี้ด้วยหรือไม่?
echo [1] ไม่ดาวน์โหลด (ข้ามไปใช้ Google Translate / Gemini ฟรีปกติ)
echo [2] ดาวน์โหลด Llama 3 8B (โมเดลแปลออฟไลน์สากล ขนาด 4.7 GB)
echo [3] ดาวน์โหลด Gemma 2 9B (โมเดลแปลภาษาไทยได้ดี ขนาด 5.5 GB)
echo [4] ดาวน์โหลด Qwen 2.5 3B (โมเดลขนาดเล็ก แปลเร็ว ขนาด 1.9 GB)
echo [5] ดาวน์โหลด Qwen 3 8B (โมเดลแปลภาษาเอเชียได้ดี ขนาด 4.7 GB)
echo.
set /p OLLAMA_CHOICE="กรอกตัวเลือก (1-5) [ค่าเริ่มต้น 1]: "
if "!OLLAMA_CHOICE!"=="" set OLLAMA_CHOICE=1

if "!OLLAMA_CHOICE!" neq "1" (
    where ollama >nul 2>nul
    if %errorlevel% neq 0 (
        echo [WARNING] ไม่พบโปรแกรม Ollama ในเครื่องคอมพิวเตอร์ของคุณ!
        echo กำลังดาวน์โหลดตัวติดตั้ง Ollama...
        curl -L -o "%temp%\OllamaSetup.exe" https://ollama.com/download/OllamaSetup.exe
        echo กำลังเปิดหน้าต่างติดตั้ง Ollama แบบเงียบ...
        "%temp%\OllamaSetup.exe" /silent
        del "%temp%\OllamaSetup.exe"
        echo [SUCCESS] ติดตั้ง Ollama สำเร็จแล้ว!
    )
    
    if "!OLLAMA_CHOICE!"=="2" ollama pull llama3:8b
    if "!OLLAMA_CHOICE!"=="3" ollama pull gemma2:9b
    if "!OLLAMA_CHOICE!"=="4" ollama pull qwen2.5:3b
    if "!OLLAMA_CHOICE!"=="5" ollama pull qwen3:8b
)

REM Create flag file to signal completion
echo. > "!FLAG_FILE!"
echo.
echo ==================================================
echo [SUCCESS] ติดตั้งและกำหนดค่าระบบเสร็จเรียบร้อยแล้ว!
echo ==================================================
echo.

:RUN_SERVER
echo [STATUS] กำลังเปิดระบบแปลภาษาเซิร์ฟเวอร์หลังบ้านด้วย GPU (CUDA)...
echo.
REM Clear any old server process listening on port 8000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000') do taskkill /f /pid %%a 2>nul
"%~dp0venv\Scripts\python.exe" "%~dp0manga-translator\backend\app.py"

pause