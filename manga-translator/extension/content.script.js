// เก็บสถานะเปิด/ปิดการแปลภาษา (เริ่มต้นเป็น false เพื่อให้กดปุ่มก่อนค่อยแปล)
let isTranslationEnabled = false;

// คิวสำหรับเก็บรูปภาพที่รอการแปล เพื่อแปลเรียงลำดับหน้า (Sequential Translation Queue)
let translationQueue = [];
let isProcessingQueue = false;

// ฟังก์ชันดึงรูปภาพในคิวไปส่งแปลทีละรูปตามลำดับหน้า
async function processTranslationQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    
    while (translationQueue.length > 0) {
        const img = translationQueue.shift();
        
        // ตรวจสอบว่ารูปภาพยังมีตัวตนใน DOM และยังคงต้องการการแปล
        if (img && document.body.contains(img) && img.dataset.mangaStatus === "processing") {
            try {
                await startSingleImageTranslation(img);
            } catch (error) {
                console.error("Queue translation item failed:", error);
                img.style.filter = "none";
                img.dataset.mangaStatus = "error";
            }
        }
    }
    
    isProcessingQueue = false;
}

// ฟังก์ชันล้าง/รีเซ็ตการแปลทั้งหมด
function resetTranslations() {
    translationQueue = [];
    isProcessingQueue = false;
    
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        if (img.dataset.mangaStatus && img.dataset.mangaStatus !== "ignored") {
            delete img.dataset.mangaStatus;
            if (img.dataset.originalSrc) {
                img.src = img.dataset.originalSrc;
                delete img.dataset.originalSrc;
            }
            if (img.dataset.translatedSrc) {
                if (img.dataset.translatedSrc.startsWith('blob:')) {
                    URL.revokeObjectURL(img.dataset.translatedSrc);
                }
                delete img.dataset.translatedSrc;
            }
            img.style.filter = "none";
        }
    });
}

// 1. ฟังก์ชันสร้าง ปุ่มแปลภาษาลอยตัวสุดพรีเมียม (Premium Floating Translation Button UI)
function createToggleUI() {
    if (document.getElementById('manga-translator-ui-container')) return;

    // ตั้งค่าเริ่มต้น manga_source_lang ใน localStorage ถ้าไม่มี
    if (!localStorage.getItem('manga_source_lang')) {
        localStorage.setItem('manga_source_lang', 'en');
    }

    const container = document.createElement('div');
    container.id = 'manga-translator-ui-container';
    container.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        z-index: 999999;
        font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        user-select: none;
        display: flex;
        flex-direction: column-reverse;
        align-items: flex-end;
        gap: 8px;
    `;

    const controlsRow = document.createElement('div');
    controlsRow.id = 'manga-translator-ui';
    controlsRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px 14px;
        border-radius: 50px;
        background: rgba(15, 23, 42, 0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3), inset 0 1px 1px 0 rgba(255, 255, 255, 0.1);
        color: #f8fafc;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;

    // ปุ่มกดแปล
    const button = document.createElement('div');
    button.id = 'manga-translator-btn';
    button.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        border-radius: 50px;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        font-size: 13px;
        font-weight: 600;
        background: transparent;
        border: 1px solid transparent;
        color: #f8fafc;
    `;

    // SVG icon สำหรับความสวยงาม
    const iconSpan = document.createElement('span');
    iconSpan.style.cssText = 'display: flex; align-items: center; justify-content: center;';
    iconSpan.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 8 11 14 17 8"/>
            <path d="M4 14 10 8 18 16"/>
            <path d="M2 5h12"/>
            <path d="M7 2h1"/>
            <path d="m22 22-5-10-5 10"/>
            <path d="M14 18h6"/>
        </svg>
    `;

    const textSpan = document.createElement('span');
    textSpan.innerText = 'แปลหน้านี้ (Translate Page)';

    button.appendChild(iconSpan);
    button.appendChild(textSpan);
    controlsRow.appendChild(button);

    // เส้นแบ่ง (Vertical Divider)
    const divider = document.createElement('div');
    divider.style.cssText = `
        width: 1px;
        height: 20px;
        background: rgba(255, 255, 255, 0.15);
    `;
    controlsRow.appendChild(divider);

    // ส่วนสลับภาษา (EN/KO Selector)
    const langContainer = document.createElement('div');
    langContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: 4px;
        background: rgba(255, 255, 255, 0.05);
        padding: 3px;
        border-radius: 50px;
        border: 1px solid rgba(255, 255, 255, 0.05);
    `;

    // ฟังก์ชันสร้างปุ่มเลือกภาษาย่อย (Sub-pill)
    function createLangPill(langCode, label) {
        const pill = document.createElement('div');
        pill.style.cssText = `
            padding: 5px 12px;
            border-radius: 50px;
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            border: 1px solid transparent;
        `;
        pill.innerText = label;
        pill.dataset.lang = langCode;
        return pill;
    }

    const enPill = createLangPill('en', 'EN');
    const koPill = createLangPill('ko', 'KO');

    langContainer.appendChild(enPill);
    langContainer.appendChild(koPill);
    controlsRow.appendChild(langContainer);

    // เส้นแบ่งที่สอง (Second Divider)
    const divider2 = document.createElement('div');
    divider2.style.cssText = `
        width: 1px;
        height: 20px;
        background: rgba(255, 255, 255, 0.15);
    `;
    controlsRow.appendChild(divider2);

    // ส่วนเลือกโมเดล (Model Selector Dropdown)
    const modelSelect = document.createElement('select');
    modelSelect.id = 'manga-model-select';
    modelSelect.style.cssText = `
        background: rgba(255, 255, 255, 0.08);
        color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 50px;
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 600;
        outline: none;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.3s;
    `;
    
    const models = [
        { value: 'gemini', label: 'Gemini 2.5 Flash' },
        { value: 'google_translate', label: 'Google Translate' },
        { value: 'llama3:8b', label: 'Llama 3 8B' },
        { value: 'gemma2:9b', label: 'Gemma 2 9B' },
        { value: 'qwen3:8b', label: 'Qwen 3 8B' },
        { value: 'qwen2.5:3b', label: 'Qwen 2.5 3B' }
    ];
    
    models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.value;
        opt.innerText = m.label;
        opt.style.background = '#0f172a';
        opt.style.color = '#f8fafc';
        modelSelect.appendChild(opt);
    });

    // โหลดโมเดลเริ่มต้น
    if (!localStorage.getItem('manga_translation_model')) {
        localStorage.setItem('manga_translation_model', 'gemini');
    }
    modelSelect.value = localStorage.getItem('manga_translation_model') || 'gemini';

    modelSelect.addEventListener('change', () => {
        localStorage.setItem('manga_translation_model', modelSelect.value);
        resetTranslations();
        if (isTranslationEnabled) {
            processImages();
        }
    });

    controlsRow.appendChild(modelSelect);

    // เส้นแบ่งที่สาม (Third Divider)
    const divider3 = document.createElement('div');
    divider3.style.cssText = `
        width: 1px;
        height: 20px;
        background: rgba(255, 255, 255, 0.15);
    `;
    controlsRow.appendChild(divider3);

    // หน้าต่างตั้งค่าที่อยู่ IP เซิร์ฟเวอร์
    const settingsPanel = document.createElement('div');
    settingsPanel.id = 'manga-translator-settings';
    settingsPanel.style.cssText = `
        display: none;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.95);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
        width: 240px;
        font-family: inherit;
        color: #f8fafc;
    `;

    const settingsTitle = document.createElement('div');
    settingsTitle.style.cssText = `
        font-size: 11px;
        font-weight: 700;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    `;
    settingsTitle.innerText = 'ตั้งค่าที่อยู่เซิร์ฟเวอร์ (Server Address)';
    settingsPanel.appendChild(settingsTitle);

    const ipInput = document.createElement('input');
    ipInput.type = 'text';
    ipInput.placeholder = 'ตัวอย่าง: http://192.168.1.100:8000';
    ipInput.style.cssText = `
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        padding: 6px 10px;
        color: #ffffff;
        font-size: 12px;
        outline: none;
        width: 100%;
        box-sizing: border-box;
        transition: all 0.2s;
    `;
    ipInput.value = localStorage.getItem('manga_api_url') || 'http://127.0.0.1:8000';
    
    ipInput.addEventListener('focus', () => {
        ipInput.style.borderColor = '#6366f1';
        ipInput.style.boxShadow = '0 0 0 2px rgba(99, 102, 241, 0.2)';
    });
    ipInput.addEventListener('blur', () => {
        ipInput.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        ipInput.style.boxShadow = 'none';
    });
    settingsPanel.appendChild(ipInput);

    const saveBtn = document.createElement('div');
    saveBtn.style.cssText = `
        background: linear-gradient(135deg, #2563eb, #7c3aed);
        color: #ffffff;
        border-radius: 6px;
        padding: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        text-align: center;
        transition: all 0.2s;
    `;
    saveBtn.innerText = 'บันทึก (Save)';
    
    saveBtn.addEventListener('mouseenter', () => {
        saveBtn.style.transform = 'scale(1.02)';
        saveBtn.style.boxShadow = '0 2px 8px rgba(99, 102, 241, 0.4)';
    });
    saveBtn.addEventListener('mouseleave', () => {
        saveBtn.style.transform = 'scale(1)';
        saveBtn.style.boxShadow = 'none';
    });
    
    saveBtn.addEventListener('click', () => {
        let val = ipInput.value.trim();
        if (val) {
            localStorage.setItem('manga_api_url', val);
            saveBtn.innerText = 'บันทึกแล้ว! (Saved)';
            saveBtn.style.background = '#10b981';
            setTimeout(() => {
                saveBtn.innerText = 'บันทึก (Save)';
                saveBtn.style.background = 'linear-gradient(135deg, #2563eb, #7c3aed)';
                settingsPanel.style.display = 'none';
            }, 800);
        }
    });
    settingsPanel.appendChild(saveBtn);

    // ปุ่มรูปเฟืองสำหรับเปิด/ปิดตั้งค่า
    const settingsBtn = document.createElement('div');
    settingsBtn.id = 'manga-settings-btn';
    settingsBtn.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        padding: 6px;
        border-radius: 50%;
        transition: all 0.3s;
        color: #94a3b8;
    `;
    settingsBtn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
    `;
    settingsBtn.addEventListener('mouseenter', () => {
        settingsBtn.style.color = '#f8fafc';
        settingsBtn.style.transform = 'rotate(30deg)';
    });
    settingsBtn.addEventListener('mouseleave', () => {
        settingsBtn.style.color = '#94a3b8';
        settingsBtn.style.transform = 'rotate(0deg)';
    });
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (settingsPanel.style.display === 'none' || settingsPanel.style.display === '') {
            settingsPanel.style.display = 'flex';
            ipInput.focus();
        } else {
            settingsPanel.style.display = 'none';
        }
    });
    controlsRow.appendChild(settingsBtn);

    container.appendChild(controlsRow);
    container.appendChild(settingsPanel);
    document.body.appendChild(container);

    // ฟังก์ชันอัปเดตสไตล์สำหรับปุ่มภาษา EN/KO
    function updateLangPillsUI() {
        const activeLang = localStorage.getItem('manga_source_lang') || 'en';
        [enPill, koPill].forEach(pill => {
            if (pill.dataset.lang === activeLang) {
                pill.style.background = 'linear-gradient(135deg, #2563eb, #7c3aed)';
                pill.style.color = '#ffffff';
                pill.style.boxShadow = '0 2px 6px rgba(59, 130, 246, 0.4)';
                pill.style.border = '1px solid rgba(255, 255, 255, 0.15)';
            } else {
                pill.style.background = 'transparent';
                pill.style.color = '#94a3b8';
                pill.style.boxShadow = 'none';
                pill.style.border = '1px solid transparent';
            }
        });
    }

    // ฟังก์ชันเปลี่ยนภาษาแบบไดนามิก
    function setLanguage(lang) {
        const currentLang = localStorage.getItem('manga_source_lang');
        if (currentLang === lang) return;

        localStorage.setItem('manga_source_lang', lang);
        updateLangPillsUI();
        
        // ล้างงานแปลเก่าเพื่อเตรียมการแปลใหม่
        resetTranslations();
        
        // ถ้าเปิดแปลอยู่ ให้รันแปลใหม่ทันที
        if (isTranslationEnabled) {
            processImages();
        }
    }

    // ลงทะเบียนเหตุการณ์คลิกเลือกภาษา
    enPill.addEventListener('click', () => setLanguage('en'));
    koPill.addEventListener('click', () => setLanguage('ko'));

    // เพิ่มเอฟเฟกต์ hover ให้ปุ่มเลือกภาษา
    [enPill, koPill].forEach(pill => {
        pill.addEventListener('mouseenter', () => {
            const activeLang = localStorage.getItem('manga_source_lang') || 'en';
            if (pill.dataset.lang !== activeLang) {
                pill.style.background = 'rgba(255, 255, 255, 0.08)';
                pill.style.color = '#f8fafc';
            }
        });
        pill.addEventListener('mouseleave', () => {
            const activeLang = localStorage.getItem('manga_source_lang') || 'en';
            if (pill.dataset.lang !== activeLang) {
                pill.style.background = 'transparent';
                pill.style.color = '#94a3b8';
            }
        });
    });

    // อัปเดตสไตล์ของปุ่มเมื่อสลับโหมดเปิด/ปิดการแปล
    function updateUIState() {
        if (isTranslationEnabled) {
            button.style.background = 'linear-gradient(135deg, #2563eb, #7c3aed)';
            button.style.border = '1px solid rgba(255, 255, 255, 0.25)';
            button.style.boxShadow = '0 0 12px rgba(59, 130, 246, 0.3)';
            textSpan.innerText = 'แสดงต้นฉบับ (Show Original)';
        } else {
            button.style.background = 'transparent';
            button.style.border = '1px solid transparent';
            button.style.boxShadow = 'none';
            textSpan.innerText = 'แปลหน้านี้ (Translate Page)';
        }
    }

    // เอฟเฟกต์ Hover ของปุ่มหลัก
    button.addEventListener('mouseenter', () => {
        if (!isTranslationEnabled) {
            button.style.background = 'rgba(255, 255, 255, 0.05)';
        } else {
            button.style.transform = 'scale(1.02)';
        }
    });

    button.addEventListener('mouseleave', () => {
        if (!isTranslationEnabled) {
            button.style.background = 'transparent';
        } else {
            button.style.transform = 'scale(1)';
        }
    });

    button.addEventListener('click', () => {
        isTranslationEnabled = !isTranslationEnabled;
        updateUIState();
        updateOverlaysVisibility();
        if (isTranslationEnabled) {
            processImages();
        }
    });

    // เรียกอัปเดตสถานะตอนเริ่มต้น
    updateUIState();
    updateLangPillsUI();
}


// 2. ฟังก์ชันหลักสำหรับจัดการรูปภาพบนเว็บไซต์ใด ๆ (Universal Web Translator)
function processImages() {
    const images = document.querySelectorAll('img');

    images.forEach(img => {
        if (img.src) {
            // หลีกเลี่ยงการจับรูป base64 ของตัวระบบเอง
            if (img.src.startsWith('data:image/jpeg;base64,')) return;

            // [ระบบเด็ด] ตรวจจับรูปภาพถูกรีไซเคิล DOM (ผู้ใช้เลื่อนหน้ามังงะเปลี่ยนรูป แต่ใช้แท็ก img เดิม)
            if (img.dataset.originalSrc && 
                img.src !== img.dataset.originalSrc && 
                img.src !== img.dataset.translatedSrc) {
                
                // ล้างสถานะทั้งหมดเพื่อให้รูปภาพหน้าใหม่ถูกส่งไปแปล
                delete img.dataset.mangaStatus;
                delete img.dataset.originalSrc;
                delete img.dataset.translatedSrc;
                img.style.filter = "none"; // รีเซ็ตฟิลเตอร์เบลอ
            }

            // [ระบบกู้คืน] หากเคยแปลแล้ว แต่ตัวเว็บ (เช่น Vue/React) รีเซ็ต src กลับเป็นของดิบ ให้สลับกลับมาเป็นแปลทันที
            if (img.dataset.mangaStatus === "translated") {
                if (isTranslationEnabled) {
                    img.style.filter = "none";
                    if (img.src !== img.dataset.translatedSrc) {
                        img.src = img.dataset.translatedSrc;
                    }
                } else {
                    if (img.src !== img.dataset.originalSrc) {
                        img.src = img.dataset.originalSrc;
                    }
                }
                return;
            }

            // ถ้าเป็นรูปใหม่และเปิดใช้งานการแปลภาษาอยู่ ให้เริ่มต้นประมวลผล
            if (!img.dataset.mangaStatus && isTranslationEnabled) {
                img.dataset.mangaStatus = "init";
                img.dataset.originalSrc = img.src;

                // เมื่อรูปภาพโหลดเสร็จ ให้ตรวจสอบขนาดและเริ่มกระบวนการแปล
                const handleLoad = () => {
                    // กรองเฉพาะภาพขนาดใหญ่ (หน้ามังงะจริง ไม่ใช่ไอคอนหรือโลโก้เล็กรบกวน)
                    const width = img.naturalWidth || img.offsetWidth;
                    if (width < 250) {
                        img.dataset.mangaStatus = "ignored";
                        return;
                    }

                    if (!isTranslationEnabled) return; // ดักตรงนี้หากผู้ใช้ปิดการแปลระหว่างรันโหลด
                    if (img.dataset.mangaStatus === "processing") return;
                    img.dataset.mangaStatus = "processing";
                    
                    // ใส่ฟิลเตอร์เบลอและเอฟเฟกต์สีเทาระหว่างที่ส่งระบบแปลข้างหลัง (ความรู้สึกไหลลื่นระดับพรีเมียม)
                    img.style.transition = "filter 0.4s ease-in-out";
                    img.style.filter = "blur(8px) grayscale(20%)";
                    
                    // เพิ่มรูปเข้าคิวและรันคิวเพื่อให้แปลทีละหน้าเรียงลำดับลงไป
                    if (!translationQueue.includes(img)) {
                        translationQueue.push(img);
                    }
                    processTranslationQueue();
                };

                if (img.complete) {
                    handleLoad();
                } else {
                    img.addEventListener('load', handleLoad, { once: true });
                }
            }
        }
    });
}

// ฟังก์ชันแปลง URL รูปภาพเป็น Base64 โดยตรงผ่าน fetch เพื่อหลีกเลี่ยงปัญหา CORS Canvas SecurityError (Insecure Canvas Tainted)
async function getBase64FromUrl(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ฟังก์ชันแปลง base64 เป็น local blob URL เพื่อป้องกันปัญหา React/Vue รีไซเคิล DOM กลับมาแปลซ้ำ
function base64ToBlobUrl(base64) {
    const parts = base64.split(';base64,');
    const contentType = parts[0].split(':')[1];
    const raw = window.atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for (let i = 0; i < rawLength; ++i) {
        uInt8Array[i] = raw.charCodeAt(i);
    }
    const blob = new Blob([uInt8Array], { type: contentType });
    return URL.createObjectURL(blob);
}

// 3. ฟังก์ชันแปลรูปภาพเดียวและบันทึกผลลงแอตทริบิวต์
async function startSingleImageTranslation(img) {
    try {
        let base64Data;
        try {
            // ใช้เทคนิคดึงไฟล์ตรง (CORS-safe & Blob-safe) ป้องกันบัก Canvas Tainted ของ Chrome
            base64Data = await getBase64FromUrl(img.src);
        } catch (fetchError) {
            // หากดึงตรงไม่สำเร็จ ให้ใช้ Canvas เป็นระบบสำรอง
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            if (canvas.width === 0 || canvas.height === 0) {
                img.dataset.mangaStatus = "error";
                img.style.filter = "none";
                return;
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            base64Data = canvas.toDataURL('image/jpeg', 0.75);
        }

        // ดึง URL ที่ผู้ใช้ตั้งค่าไว้ (รองรับการรันจากมือถือชี้มาที่ IP คอมพิวเตอร์หลัก)
        let serverUrl = localStorage.getItem('manga_api_url') || 'http://127.0.0.1:8000';
        serverUrl = serverUrl.trim();
        if (!/^https?:\/\//i.test(serverUrl)) {
            serverUrl = 'http://' + serverUrl;
        }
        const cleanServerUrl = serverUrl.replace(/\/$/, '');

        // ส่งข้อมูลไป Python Backend พร้อมระบุภาษาต้นทาง (EN/KO)
        const response = await fetch(`${cleanServerUrl}/translate_base64`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                image_base64: base64Data,
                source_lang: localStorage.getItem('manga_source_lang') || 'en',
                translation_model: localStorage.getItem('manga_translation_model') || 'gemini'
            })
        });
        
        const data = await response.json();
        
        if (data.image) {
            // แปลง base64 ที่ได้รับจากเซิร์ฟเวอร์เป็น blob URL ชั่วคราวฝั่งเบราว์เซอร์
            const blobUrl = base64ToBlobUrl(data.image);
            img.dataset.translatedSrc = blobUrl;
            img.dataset.mangaStatus = "translated";
            img.style.filter = "none"; // เอาเอฟเฟกต์เบลอออกเมื่อแปลผลเรียบร้อย
            
            // เปลี่ยนรูปในหน้าจอหากผู้ใช้เปิดใช้งานการแปล
            if (isTranslationEnabled) {
                img.src = blobUrl;
            }
        } else {
            img.dataset.mangaStatus = "error";
            img.style.filter = "none";
        }

    } catch (e) {
        console.error("Translation error for", img.src, e);
        img.dataset.mangaStatus = "error";
        img.style.filter = "none";
    }
}

// 4. ฟังก์ชันควบคุมการแสดงผลตามสถานะเปิด/ปิด
function updateOverlaysVisibility() {
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        if (img.dataset.mangaStatus === "translated") {
            if (isTranslationEnabled) {
                if (img.dataset.translatedSrc && img.src !== img.dataset.translatedSrc) {
                    img.src = img.dataset.translatedSrc;
                }
            } else {
                if (img.dataset.originalSrc && img.src !== img.dataset.originalSrc) {
                    img.src = img.dataset.originalSrc;
                }
            }
        }
    });
}

// เริ่มต้นรันระบบเมื่อหน้าเว็บโหลดเสร็จ (สร้างเฉพาะปุ่มลอย และเริ่มรอการกดแปล)
createToggleUI();
processImages();

// ดักจับการเปลี่ยนแปลงเพื่อแปลรูปภาพใหม่เมื่อระบบถูกสั่งเปิดใช้งานแบบแมนนวล
const observer = new MutationObserver(() => processImages());
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
