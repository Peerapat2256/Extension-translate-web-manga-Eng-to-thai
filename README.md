# Manga Universal Translator 2.0 (English/Korean to Thai) - ภาษาไทย

ระบบแปลภาษาหน้าเว็บมังงะและเว็บตูน (Manga & Webtoon) จากภาษาอังกฤษและภาษาเกาหลีให้เป็นภาษาไทยโดยอัตโนมัติ ด้วยระบบตรวจจับข้อความและช่องคำพูดระดับ Deep Learning (**Comic-Text-Detector ONNX** + **Native Tiled EasyOCR**) ลบข้อความเดิมแบบคงลายเส้นตัวละคร 100% (**Precision Stroke Inpainting**) และแปลผลด้วยปัญญาประดิษฐ์ (AI) ชั้นนำอย่าง Gemini และ Ollama (Local AI) พร้อมรองรับการประมวลผลบนคอมพิวเตอร์หลักเพื่อใช้งานบนโทรศัพท์มือถือ (iOS และ Android) ได้ทันที

---

## 🌟 ฟีเจอร์เด่นในเวอร์ชัน 2.0 (Key Features)

*   **⚡ Adaptive Preload Supervisor (ระบบตรวจจับและแปลต่อเนื่องอัจฉริยะ):**
    *   ตรวจจับอัตโนมัติว่าหน้าเว็บดาวน์โหลดรูปภาพเข้ามาในหน่วยความจำแล้วกี่หน้า และทยอยแปลต่อเนื่องตามจำนวนหน้าที่โหลดจริง
    *   ไร้ปัญหาบัคค้าง 100% (Zero Freeze) ไม่ส่งภาพที่ยังไม่โหลดหรือ Placeholder ว่างๆ เข้าสู่ระบบ
    *   **Dynamic Viewport Priority:** สลับมาแปลหน้าที่อยู่ตรงระดับสายตาของผู้ใช้อ่านจริงก่อนเสมอ
    *   **Instant Scroll & DOM Mutation:** เลื่อนจอลงไปแล้วเว็บโหลดรูปเพิ่ม ระบบจะตื่นมาตรวจจับและแปลต่อทันที
*   **📜 Webtoon Auto-Tiling (ประมวลผลเว็บตูนภาพยาวความละเอียดเต็ม 100%):**
    *   แก้ปัญหาตัวหนังสือเละบนภาพยาวแบบ Long Strip (เช่น ภาพสูง 4,000–10,000+ พิกเซล) ด้วยการตัดสไลซ์ภาพย่อยที่ความสูง 2,200px แบบเหลื่อมซ้อน (Overlap 300px)
    *   OCR ทำงานที่ **Native 1:1 Scale** ตัวอักษรคมชัด ไม่ถูกบีบอัดสัดส่วน
    *   ผสานผลลัพธ์ด้วย **Non-Maximum Suppression (NMS)** คัดกรองกล่องข้อความซ้ำซ้อนบริเวณรอยต่อได้อย่างสมบูรณ์แบบ
*   **🛡️ Precision Stroke Inpainting & Artwork Protection (ลบตัวอักษรเนียนกริบ ไม่ล้นโดนตัวละคร):**
    *   สร้างมาสก์ระดับลายเส้นตัวอักษรจากโมเดล Deep Learning Comic-Text-Detector
    *   มีระบบ **Background Uniformity Check (`std < 25`)** และ **Physical Boundary Clamps** ป้องกันกรอบโพลีกอนล้นไปกินใบหน้า ดวงตา หรือลายเส้นของตัวละคร
*   **🎨 Dynamic Thai Typesetter (จัดวางฟอนต์ภาษาไทยคมชัดระดับสตูดิโอ):**
    *   ตัดคำภาษาไทยอัตโนมัติและจัดกึ่งกลางตามรูปทรงของบอลลูนคำพูด
    *   ใส่เส้นขอบตัวอักษรหนา 2–3px (Contrasting Stroke Outline) ช่วยให้อ่านง่ายบนทุกพื้นหลัง
*   **🤖 Advanced Multi-Engine Translation:**
    *   **Local AI (Ollama):** Gemma 2 9B, Qwen 2.5 3B, Qwen 3 8B (ออฟไลน์ 100% ไร้ค่าใช้จ่าย)
    *   **Gemini 2.5 Flash API:** แปลบทสนทนาได้สละสลวย รวดเร็วและบริบทแม่นยำ
    *   **Google Translate Seamless Fallback:** สลับอัตโนมัติเมื่อโควตา API หรือ Local AI ใช้เวลาเกินกำหนด
*   **📱 Universal Mobile Support:**
    *   ใช้งานบนมือถือ Android ผ่าน Kiwi Browser
    *   ใช้งานบน iOS Safari ผ่านแอป Userscripts (รองรับทั้งผ่าน Wi-Fi ท้องถิ่น หรือรีโมทผ่านอุโมงค์ HTTPS ปลอดภัยด้วย ngrok)

---

## 💻 การติดตั้งและตั้งค่าระบบหลังบ้าน (Backend Setup)

### ความต้องการของระบบ (Prerequisites)
*   ระบบปฏิบัติการ Windows 10 / 11
*   Python 3.10 ขึ้นไป (แนะนำ Python 3.11)
*   การ์ดจอ NVIDIA ที่รองรับ CUDA (ระบบจะใช้ GPU ประมวลผลทั้ง ONNX และ OCR โดยอัตโนมัติ)

### ขั้นตอนการเริ่มทำงาน
1.  **ตั้งค่ารหัส API Key (ไม่บังคับหากใช้ Local AI / Google Fallback):**
    สร้างไฟล์ชื่อ `.env` ไว้ในโฟลเดอร์หลักของโปรเจกต์:
    ```env
    GEMINI_API_KEY=your_actual_gemini_api_key_here
    ```
2.  **เริ่มรันเซิร์ฟเวอร์:**
    ดับเบิลคลิกไฟล์ **`run_backend.bat`** ในโฟลเดอร์หลัก 
    *   ระบบจะตรวจสอบโมเดล `comic-text-detector.onnx` หากยังไม่มีจะดาวน์โหลดจาก HuggingFace ให้อัตโนมัติ
    *   ตรวจสอบและเริ่มบริการ Ollama ในพื้นหลังให้อัตโนมัติ (หากมีติดตั้งในเครื่อง)
    *   เซิร์ฟเวอร์หลังบ้านจะเริ่มทำงานที่ `http://0.0.0.0:8000`

---

## 🔌 การติดตั้งส่วนขยายบนคอมพิวเตอร์ (PC Extension Setup)

1.  เปิดเบราว์เซอร์ **Google Chrome** (หรือ Edge, Brave)
2.  ไปที่: `chrome://extensions/`
3.  เปิดใช้งาน **Developer Mode (โหมดนักพัฒนา)** ที่มุมขวาบน
4.  คลิกปุ่ม **Load unpacked (โหลดส่วนขยายที่แตกโฟลเดอร์แล้ว)** ที่มุมซ้ายบน
5.  เลือกโฟลเดอร์ **`manga-translator/extension`** ในโปรเจกต์นี้
6.  เปิดหน้าเว็บมังงะ/เว็บตูนใดๆ จะพบแถบเครื่องมือลอยตัวสไตล์ Glassmorphism แสดงขึ้นมาพร้อมใช้งาน

---

## 📱 การติดตั้งและใช้งานบนโทรศัพท์มือถือ (Mobile Devices Setup)

### 🤖 วิธีที่ 1: สำหรับ Android (ผ่าน Kiwi Browser)
1.  ติดตั้ง **Kiwi Browser** จาก Play Store
2.  เปิด Kiwi Browser ไปที่ `chrome://extensions/` แล้วเปิดโหมดนักพัฒนา
3.  โหลดโฟลเดอร์ `extension` เข้าไปในเบราว์เซอร์
4.  เมื่อเข้าหน้าเว็บมังงะ คลิกที่ **ไอคอนรูปเฟือง** บนแถบลอยตัว
5.  กรอกที่อยู่ IP คอมพิวเตอร์ของคุณ (เช่น `http://192.168.1.109:8000`) แล้วกดบันทึก

---

### 🍏 วิธีที่ 2: สำหรับ iOS (Safari + Userscripts)
1.  ติดตั้งแอป **Userscripts** จาก App Store
2.  เปิดการอนุญาตใน: `Settings > Safari > ส่วนขยาย (Extensions) > เปิด Userscripts` (ตั้งค่าเป็น **Always Allow** ทุกเว็บไซต์)
3.  เปิดแอป Userscripts แล้วกำหนดโฟลเดอร์สำหรับเก็บสคริปต์ในแอป Files
4.  บน Safari ให้เปิดลิงก์ดาวน์โหลดสคริปต์จากเซิร์ฟเวอร์คอมพิวเตอร์ของคุณ:
    ```text
    http://<เลขไอพีคอมพิวเตอร์ของคุณ>:8000/manga-translator.user.js
    ```
5.  กด **"Install" (หรือ "บันทึก")** ในหน้าต่างของแอป Userscripts
6.  เปิดหน้าเว็บมังงะใน Safari แถบแปลภาษาจะแสดงผลขึ้นมาทันที

---

## 🔒 วิธีแก้ปัญหาความปลอดภัย iOS ด้วย "ngrok" (HTTPS Tunnel)
หากเปิดใน Safari บน iOS แล้วภาพหายเบลอเร็วและไม่ยอมแปล เกิดจาก Safari บล็อก Mixed Content (หน้าเว็บ HTTPS ส่งหาเซิร์ฟเวอร์ HTTP):
1.  ดาวน์โหลดและสมัครใช้งาน **[ngrok](https://ngrok.com/)**
2.  เปิดเทอร์มินัลแล้วรันคำสั่ง:
    ```bash
    ngrok http 8000
    ```
3.  คัดลอกลิงก์ HTTPS จากช่อง **Forwarding** (เช่น `https://xxxx.ngrok-free.app`)
4.  นำไปกรอกลงใน **ช่องรูปเฟือง** ของแถบเครื่องมือแปลภาษาบนมือถือ เพื่อใช้งานได้ปลอดภัย 100% แม้อยู่นอกบ้าน

---

## 🛠️ โครงสร้างโฟลเดอร์ของโปรเจกต์ (Modular Architecture 2.0)
```text
manga-translator/
├── backend/
│   ├── app.py                     # Entry point หลักของ FastAPI Server
│   ├── api/                       # API Routing Layer
│   │   └── v1/translate_routes.py # เอ็นด์พอยต์ /translate_base64 และ Healthcheck
│   ├── core/                      # การจัดการระบบหลัก แคช และคอนฟิก
│   │   ├── config.py              # การตั้งค่าระบบ และ Golden Baseline Configuration
│   │   └── cache_manager.py       # ระบบแคชผลลัพธ์ภาพแปลซ้ำ
│   ├── vision/                    # การประมวลผลภาพขั้นสูง
│   │   ├── comic_detector.py      # Comic-Text-Detector ONNX + Auto-Tiling
│   │   ├── bubble_detector.py     # ระบบรวมบรรทัดเข้าเป็นช่องคำพูด (Hierarchical Clustering)
│   │   ├── deskew_normalizer.py   # ตรวจจับมุมเอียงและปรับคอนทราสต์ CLAHE
│   │   └── style_extractor.py     # วิเคราะห์สีพื้นหลังและสีตัวอักษร
│   ├── ocr/                       # ระบบอ่านข้อความ
│   │   ├── comic_recognizer.py    # Native Tiled EasyOCR + Inverted Text Recovery
│   │   └── spell_corrector.py     # ตัวกรองคำผิด ลายน้ำ และเสียงเอฟเฟกต์
│   ├── inpainting/                # ระบบลบตัวอักษรต้นฉบับ
│   │   ├── dual_cleaner.py        # ลบข้อความเฉพาะในบอลลูนคำพูด พร้อมระบบป้องกันใบหน้า
│   │   └── mask_generator.py      # ตัวสร้างมาสก์ภาพ
│   ├── translator/                # ตัวเชื่อมต่อ AI แปลภาษา
│   │   ├── gemini_engine.py       # Gemini 2.5 Flash API
│   │   ├── ollama_engine.py       # Local Ollama AI (Gemma 2, Qwen 2.5/3)
│   │   └── google_engine.py       # Google Translate Seamless Fallback
│   └── typesetter/                # ระบบพิมพ์และจัดวางตัวอักษร
│       ├── graphic_renderer.py    # เรนเดอร์ฟอนต์ภาษาไทยและเส้นขอบตัวอักษร
│       └── thai_formatter.py      # ตัดคำและจัดรูปประโยคภาษาไทย
├── extension/                     # Chrome Extension (Manifest V3 + Background Service Worker)
│   ├── content.script.js          # Adaptive Preload Supervisor Script
│   ├── background.js              # CORS Bypass Service Worker
│   └── manifest.json
├── userscript/
│   └── manga-translator.user.js   # สคริปต์รวมสำหรับ iOS Safari & Tampermonkey
├── run_backend.bat                # ตัวเปิดระบบอัตโนมัติบน Windows
└── README.md
```

---

## 📌 จุดอ้างอิงมาตรฐาน (Golden Baseline Tag)
โปรเจกต์นี้ได้รับการทดสอบและบันทึกจุดอ้างอิงมาตรฐานประสิทธิภาพสูงสุดไว้ที่ Git Tag:
```bash
git checkout v2.0-golden-baseline
```
สามารถตรวจสอบรายละเอียดพารามิเตอร์ทั้งหมดได้ที่ไฟล์ [**`golden_baseline_specs.md`**](golden_baseline_specs.md)
