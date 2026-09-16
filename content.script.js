// เก็บสถานะเปิด/ปิดการแปลภาษา (เริ่มต้นเป็น false)
let isTranslationEnabled = false;
let isTranslatingLoopRunning = false;
let isInternalSrcChange = false;

// ฟังก์ชันตรวจจับรูปภาพที่ไม่ใช่หน้ามังงะ (ป้ายรับบริจาค, ไอคอน, โลโก้, ป้ายโฆษณา, อวาตาร์, อีโมจิ ฯลฯ)
function isNonMangaAsset(img) {
    if (!img) return true;
    
    const src = (img.src || img.dataset.originalSrc || img.currentSrc || '').toLowerCase();
    const alt = (img.alt || '').toLowerCase();
    const className = (img.className || '').toString().toLowerCase();
    const id = (img.id || '').toLowerCase();

    // 1. ตรวจสอบคำค้นหาที่เป็น asset เว็บ, โฆษณา, หรือปุ่มบริจาค
    const nonMangaKeywords = [
        'support-us', 'support_us', 'donate', 'patreon', 'ko-fi', 'kofi',
        'discord', 'banner', 'badge', 'sponsor', 'advert', 'advertisement',
        'affiliate', 'promo', 'social', 'reaction', 'emoji', 'emoticon',
        'logo', 'avatar', 'profile', 'icon', 'favicon', 'button', 'arrow',
        'watermark-logo', 'loading', 'spinner', 'placeholder'
    ];

    if (nonMangaKeywords.some(kw => src.includes(kw) || alt.includes(kw) || className.includes(kw) || id.includes(kw))) {
        return true;
    }

    // 2. อยู่ใน Container ที่เป็น UI เว็บ ไม่ใช่เนื้อหาตอนมังงะ
    try {
        if (img.closest('header, footer, nav, aside, .comment, .comments, #comments, .disqus, .sidebar, .menu, .ad-container, .adsbygoogle')) {
            return true;
        }
    } catch (e) {}

    // 3. นามสกุลไฟล์หรือประเภท Data URL ที่ไม่ใช่รูปมังงะ (SVG, GIF)
    if (src.includes('.svg') || src.startsWith('data:image/svg') || src.includes('.gif')) {
        return true;
    }

    // 4. สัดส่วนและขนาด (Aspect Ratio & Dimensions) หากรูปดาวน์โหลดเสร็จแล้ว
    const nw = img.naturalWidth || 0;
    const nh = img.naturalHeight || 0;
    if (nw > 0 && nh > 0) {
        if (nw < 250 || nh < 250) {
            return true;
        }
        if (nw / nh > 2.7) {
            return true;
        }
        if (nh / nw > 25.0) {
            return true;
        }
    }

    return false;
}

// ฟังก์ชันค้นหารูปภาพหน้ามังงะทั้งหมดในหน้าเว็บ และเรียงลำดับจากบนสุดลงล่างสุดตามตำแหน่งจริง
function getSortedMangaImages() {
    const allImgs = Array.from(document.querySelectorAll('img'));
    const mangaImgs = allImgs.filter(img => {
        if (isNonMangaAsset(img)) return false;

        const nw = img.naturalWidth || 0;
        const nh = img.naturalHeight || 0;
        if (nw > 0 && nh > 0) {
            return nw >= 250 && nh >= 250;
        }

        const rw = img.width || img.offsetWidth || 0;
        const rh = img.height || img.offsetHeight || 0;
        if (rw >= 200 || rh >= 200) return true;

        const src = img.getAttribute('data-src') || 
                    img.getAttribute('data-lazy-src') || 
                    img.getAttribute('data-original') || 
                    img.getAttribute('data-url') ||
                    img.getAttribute('data-full-src') || 
                    img.src || '';
        return src.length > 15;
    });

    // เรียงลำดับจากบนสุดของหน้าเว็บลงมาล่างสุด (Top-to-Bottom)
    mangaImgs.sort((a, b) => {
        const topA = a.getBoundingClientRect().top + window.scrollY;
        const topB = b.getBoundingClientRect().top + window.scrollY;
        return topA - topB;
    });

    return mangaImgs;
}

// หาตำแหน่งหน้าที่ผู้ใช้กำลังอ่านอยู่ตามตำแหน่งการเลื่อนจอ (Current Viewport Reading Index)
function findCurrentReadingIndex(images) {
    if (!images || images.length === 0) return 0;
    const viewTop = window.scrollY;
    const viewMid = viewTop + (window.innerHeight * 0.35);

    let bestIdx = 0;
    let minDistance = Infinity;

    for (let i = 0; i < images.length; i++) {
        const rect = images[i].getBoundingClientRect();
        const imgTop = rect.top + window.scrollY;
        const imgBottom = rect.bottom + window.scrollY;

        if (imgTop <= viewMid && imgBottom >= viewMid) {
            return i;
        }
        const dist = Math.abs(imgTop - viewTop);
        if (dist < minDistance) {
            minDistance = dist;
            bestIdx = i;
        }
    }
    return bestIdx;
}

// ตรวจสอบและดึงข้อมูลรูปภาพต้นฉบับให้พร้อมก่อนส่งแปล
async function ensureImageReady(img) {
    if (img.complete && img.naturalWidth >= 200 && img.naturalHeight >= 200) {
        return true;
    }

    if (img.loading === 'lazy') img.loading = 'eager';
    if (img.hasAttribute('loading')) img.removeAttribute('loading');

    const realSrc = img.getAttribute('data-src') || 
                    img.getAttribute('data-lazy-src') || 
                    img.getAttribute('data-original') || 
                    img.getAttribute('data-url') ||
                    img.getAttribute('data-full-src');
    if (realSrc && (!img.src || img.src.startsWith('data:') || img.src.includes('placeholder') || (img.complete && img.naturalWidth <= 10))) {
        img.src = realSrc;
    }

    if (img.complete && img.naturalWidth >= 200) {
        return true;
    }

    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 3000);
        img.addEventListener('load', () => {
            clearTimeout(timer);
            resolve(true);
        }, { once: true });
        img.addEventListener('error', () => {
            clearTimeout(timer);
            resolve(false);
        }, { once: true });
    });
}

// ตัวแปรควบคุมระบบแปลอัตโนมัติตามหน้าที่เว็บโหลดไว้ (Adaptive Preload Supervisor)
let scrollDebounceTimer = null;
let supervisorWakeupResolver = null;
let domMutationObserver = null;

function wakeSupervisor() {
    if (supervisorWakeupResolver) {
        supervisorWakeupResolver();
        supervisorWakeupResolver = null;
    }
}

function sleepOrWake(ms) {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            supervisorWakeupResolver = null;
            resolve();
        }, ms);
        supervisorWakeupResolver = () => {
            clearTimeout(timer);
            resolve();
        };
    });
}

// ฟังก์ชันตรวจสอบว่าภาพถูกดาวน์โหลดและพร้อมประมวลผล 100% หรือยัง (ป้องกันการส่งภาพว่าง/ภาพยังไม่โหลด)
function isImageLoadedAndReady(img) {
    if (!img) return false;
    if (typeof isNonMangaAsset === 'function' && isNonMangaAsset(img)) return false;

    // ต้องเป็นรูปที่เบราว์เซอร์ดาวน์โหลดข้อมูลบิตแมปเสร็จสมบูรณ์แล้ว
    if (!img.complete) return false;
    const nw = img.naturalWidth || 0;
    const nh = img.naturalHeight || 0;
    if (nw < 200 || nh < 200) return false;

    const src = (img.currentSrc || img.src || '').toLowerCase();
    if (src.includes('placeholder') || src.includes('blank.gif') || src.includes('spacer.gif')) {
        return false;
    }
    return true;
}

// ค้นหาหน้ามังงะที่พร้อมแปล โดยเน้นหน้าตรงระยะสายตาลงไปก่อน แล้วตามด้วยหน้าที่โหลดแล้วด้านบน
function findNextLoadedTarget(mangaImages, currIdx) {
    // 1. ตรวจสอบตั้งแต่หน้าที่ผู้ใช้อ่านอยู่ (currIdx) ไล่ลงไปจนถึงหน้าสุดท้าย
    for (let i = currIdx; i < mangaImages.length; i++) {
        const img = mangaImages[i];
        if (img.dataset.mangaStatus !== "translated" && img.dataset.mangaStatus !== "ignored") {
            if (isImageLoadedAndReady(img)) {
                return { img, index: i };
            }
        }
    }

    // 2. หากด้านล่างแปลครบแล้ว ตรวจสอบหน้าที่อยู่เหนือกึ่งกลางสายตา (0 ถึง currIdx - 1) ที่โหลดไว้แล้ว
    for (let i = 0; i < currIdx; i++) {
        const img = mangaImages[i];
        if (img.dataset.mangaStatus !== "translated" && img.dataset.mangaStatus !== "ignored") {
            if (isImageLoadedAndReady(img)) {
                return { img, index: i };
            }
        }
    }

    return null;
}

// Supervisor Loop ควบคุมการแปลต่อเนื่องแบบตรวจจับหน้าที่เว็บโหลดแล้วแบบ Real-Time (ไร้บัคค้าง)
async function translationSupervisorLoop() {
    if (isTranslatingLoopRunning) return;
    isTranslatingLoopRunning = true;

    try {
        while (isTranslationEnabled) {
            const mangaImages = getSortedMangaImages();
            if (mangaImages.length === 0) {
                await sleepOrWake(800);
                continue;
            }

            // 1. หาตำแหน่งหน้าที่ผู้ใช้อ่านอยู่จริง ณ ขณะนี้ (Viewport Reading Index)
            const currIdx = findCurrentReadingIndex(mangaImages);

            // 2. กระตุ้นให้เบราว์เซอร์ดาวน์โหลดภาพใกล้สายตาล่วงหน้า (Eager Load Near Viewport)
            for (let i = currIdx; i < Math.min(mangaImages.length, currIdx + 6); i++) {
                const img = mangaImages[i];
                if (img.loading === 'lazy') img.loading = 'eager';
                if (img.hasAttribute('loading')) img.removeAttribute('loading');
            }

            // 3. ใส่เอฟเฟกต์เบลอเฉพาะหน้าที่โหลดเสร็จแล้วและอยู่ในระยะสายตา + ถัดไป (ที่ยังไม่ได้แปล)
            for (let i = currIdx; i < Math.min(mangaImages.length, currIdx + 5); i++) {
                const img = mangaImages[i];
                if (img.dataset.mangaStatus !== "translated" && img.dataset.mangaStatus !== "processing") {
                    if (isImageLoadedAndReady(img)) {
                        img.style.transition = "filter 0.4s ease-in-out";
                        img.style.filter = "blur(6px) grayscale(15%)";
                    }
                }
            }

            // 4. หาหน้าที่เว็บโหลดเสร็จแล้วและยังไม่ได้แปล
            const target = findNextLoadedTarget(mangaImages, currIdx);

            // นับจำนวนหน้าที่โหลดแล้ว และหน้าที่แปลเสร็จแล้ว
            const loadedCount = mangaImages.filter(isImageLoadedAndReady).length;
            const translatedCount = mangaImages.filter(img => img.dataset.mangaStatus === "translated").length;

            if (!target) {
                // หากทุกหน้าที่เว็บโหลดมา ณ ปัจจุบันแปลครบหมดแล้ว
                const textSpan = document.querySelector('#manga-translator-btn span:last-child');
                if (textSpan && isTranslationEnabled) {
                    if (translatedCount >= mangaImages.length) {
                        textSpan.innerText = `แปลครบทุกหน้าแล้ว (${mangaImages.length} หน้า)`;
                    } else {
                        textSpan.innerText = `พร้อมอ่าน (แปลแล้ว ${translatedCount}/${mangaImages.length} หน้า - เลื่อนลงเพื่อแปลต่อ)`;
                    }
                }
                // พักรอจนกว่าผู้ใช้จะเลื่อนจอ หรือเว็บจะโหลดภาพถัดไปเพิ่ม
                await sleepOrWake(400);
                continue;
            }

            const targetImg = target.img;
            const targetIdx = target.index;

            // 5. อัปเดตสถานะปุ่มลอย แสดงความคืบหน้าแบบ Real-Time
            const textSpan = document.querySelector('#manga-translator-btn span:last-child');
            if (textSpan && isTranslationEnabled) {
                textSpan.innerText = `กำลังแปลหน้า ${targetIdx + 1}/${mangaImages.length} (โหลดแล้ว ${loadedCount} หน้า)...`;
            }

            // 6. ส่งแปลภาพนี้ทันที (มั่นใจได้ 100% ว่าภาพพร้อม ไม่มีบัคค้าง)
            targetImg.dataset.mangaStatus = "processing";
            await startSingleImageTranslation(targetImg);
            targetImg.style.filter = "none";

            // สลับไปหน้าถัดไปทันที และรอบถัดไปจะดึงพิกัดสายตาล่าสุดและตรวจจับรูปใหม่อัตโนมัติ
            await new Promise(r => setTimeout(r, 80));
        }
    } catch (err) {
        console.error('[Manga Translator] Supervisor translation loop error:', err);
    } finally {
        isTranslatingLoopRunning = false;
    }
}

// ตรวจจับการเลื่อนจอ (Debounced Scroll Listener)
function handleReadingScroll() {
    if (!isTranslationEnabled) return;
    clearTimeout(scrollDebounceTimer);
    scrollDebounceTimer = setTimeout(() => {
        if (isTranslationEnabled) {
            wakeSupervisor();
            if (!isTranslatingLoopRunning) {
                translationSupervisorLoop();
            }
        }
    }, 100);
}

// เริ่มต้นระบบแปลอัตโนมัติตามหน้าที่เว็บโหลดไว้
async function startSequentialChapterTranslation() {
    window.removeEventListener('scroll', handleReadingScroll);
    window.addEventListener('scroll', handleReadingScroll, { passive: true });

    // ตรวจจับเมื่อเว็บโหลดภาพใหม่เข้ามาใน DOM
    if (!domMutationObserver) {
        domMutationObserver = new MutationObserver(() => {
            if (isTranslationEnabled) {
                wakeSupervisor();
            }
        });
        domMutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    await translationSupervisorLoop();
}

// ฟังก์ชันหยุดและกู้คืนรูปต้นฉบับทั้งหมดทันทีเมื่อผู้ใช้กดปิด
function stopSequentialChapterTranslation() {
    window.removeEventListener('scroll', handleReadingScroll);
    if (domMutationObserver) {
        domMutationObserver.disconnect();
        domMutationObserver = null;
    }
    isTranslatingLoopRunning = false;
    clearTimeout(scrollDebounceTimer);
    wakeSupervisor();
    
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        img.style.filter = "none";
        const original = img.dataset.originalBlobUrl || img.dataset.originalDataUrl || img.dataset.originalSrc;
        if (original && img.src !== original) {
            isInternalSrcChange = true;
            img.src = original;
            setTimeout(() => { isInternalSrcChange = false; }, 100);
        }
    });

    const textSpan = document.querySelector('#manga-translator-btn span:last-child');
    if (textSpan) {
        textSpan.innerText = 'แปลหน้านี้ (Translate Page)';
    }
}

// ฟังก์ชันล้าง/รีเซ็ตการแปลทั้งหมด
function resetTranslations() {
    window.removeEventListener('scroll', handleReadingScroll);
    if (domMutationObserver) {
        domMutationObserver.disconnect();
        domMutationObserver = null;
    }
    isTranslatingLoopRunning = false;
    clearTimeout(scrollDebounceTimer);
    wakeSupervisor();
    
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        if (img.dataset.mangaStatus && img.dataset.mangaStatus !== "ignored") {
            delete img.dataset.mangaStatus;
            const original = img.dataset.originalSrc || img.dataset.originalDataUrl;
            if (original) {
                img.src = original;
                delete img.dataset.originalSrc;
                delete img.dataset.originalDataUrl;
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

// 1. ฟังก์ชันสร้าง ปุ่มแปลภาษาลอยตัวสุดพรีเมียม (Premium Collapsible Floating Toolbar)
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
        bottom: 24px;
        right: 24px;
        z-index: 999999;
        font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        user-select: none;
        display: flex;
        flex-direction: column-reverse;
        align-items: flex-end;
        gap: 8px;
    `;

    // แถบควบคุมหลักแบบเต็ม (Full Controls Row)
    const controlsRow = document.createElement('div');
    controlsRow.id = 'manga-translator-ui';
    controlsRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px 14px;
        border-radius: 50px;
        background: rgba(15, 23, 42, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.35), 0 8px 10px -6px rgba(0, 0, 0, 0.35), inset 0 1px 1px 0 rgba(255, 255, 255, 0.1);
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

    // เส้นแบ่งที่ 1 (Vertical Divider)
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

    // เส้นแบ่งที่ 2 (Second Divider)
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
        { value: 'google_translate', label: '🌐 Google Translate (ความเร็วแสง 0.2 วิ - แนะนำ เสถียรสุด)' },
        { value: 'local_qwen25', label: '⚡ Local AI: Qwen 2.5 3B (เร็วเบา 1-2 วิ - ออฟไลน์)' },
        { value: 'gemini', label: '✨ Gemini 2.5 Flash (AI ภาษาการ์ตูน - ออนไลน์)' },
        { value: 'local_gemma2', label: '💻 Local AI: Gemma 2 9B (ฉลาดสูง - ออฟไลน์)' },
        { value: 'local_qwen3', label: '💻 Local AI: Qwen 3 8B (โมเดล Qwen - ออฟไลน์)' }
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
        localStorage.setItem('manga_translation_model', 'google_translate');
    }
    modelSelect.value = localStorage.getItem('manga_translation_model') || 'google_translate';

    // สลับโมเดลทันทีแม้กำลังแปลอยู่ (Live Model Switching)
    modelSelect.addEventListener('change', () => {
        const newModel = modelSelect.value;
        localStorage.setItem('manga_translation_model', newModel);
        console.log('[Manga Translator] Switched model to:', newModel);
        
        resetTranslations();
        
        if (isTranslationEnabled) {
            startSequentialChapterTranslation();
        }
    });

    controlsRow.appendChild(modelSelect);

    // เส้นแบ่งที่ 3 (Third Divider)
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
    ipInput.placeholder = '192.168.1.100:8000';
    ipInput.value = localStorage.getItem('manga_api_url') || 'http://127.0.0.1:8000';
    ipInput.style.cssText = `
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        padding: 6px 8px;
        color: #ffffff;
        font-size: 11px;
        outline: none;
        font-family: monospace;
    `;
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
    settingsBtn.title = 'ตั้งค่าที่อยู่เซิร์ฟเวอร์';
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

    // เส้นแบ่งที่ 4 (Fourth Divider)
    const divider4 = document.createElement('div');
    divider4.style.cssText = `
        width: 1px;
        height: 20px;
        background: rgba(255, 255, 255, 0.15);
    `;
    controlsRow.appendChild(divider4);

    // ปุ่มพับเก็บแถบเมนู (Collapse Toolbar Button)
    const collapseBtn = document.createElement('div');
    collapseBtn.id = 'manga-collapse-btn';
    collapseBtn.title = 'พับเก็บเมนู (ซ่อนไม่ให้บังจอ)';
    collapseBtn.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        padding: 6px 8px;
        border-radius: 50%;
        transition: all 0.25s ease;
        color: #94a3b8;
    `;
    collapseBtn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="m9 18 6-6-6-6"/>
        </svg>
    `;
    collapseBtn.addEventListener('mouseenter', () => {
        collapseBtn.style.color = '#f8fafc';
        collapseBtn.style.transform = 'scale(1.2)';
    });
    collapseBtn.addEventListener('mouseleave', () => {
        collapseBtn.style.color = '#94a3b8';
        collapseBtn.style.transform = 'scale(1)';
    });
    collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setUICollapsed(true);
    });
    controlsRow.appendChild(collapseBtn);

    // ปุ่มลอยขนาดเล็กเมื่อพับเก็บ (Mini Floating Button when collapsed)
    const collapsedBtn = document.createElement('div');
    collapsedBtn.id = 'manga-collapsed-btn';
    collapsedBtn.title = 'คลิกเพื่อเปิดเมนูแปลภาษา (Manga Translator)';
    collapsedBtn.style.cssText = `
        display: none;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: rgba(15, 23, 42, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
        color: #f8fafc;
        cursor: pointer;
        position: relative;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    collapsedBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 8 11 14 17 8"/>
            <path d="M4 14 10 8 18 16"/>
            <path d="M2 5h12"/>
            <path d="M7 2h1"/>
            <path d="m22 22-5-10-5 10"/>
            <path d="M14 18h6"/>
        </svg>
        <span id="manga-collapsed-indicator" style="
            position: absolute;
            top: 4px;
            right: 4px;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #10b981;
            box-shadow: 0 0 8px #10b981;
            display: none;
        "></span>
    `;

    collapsedBtn.addEventListener('mouseenter', () => {
        collapsedBtn.style.transform = 'scale(1.1)';
        collapsedBtn.style.boxShadow = '0 12px 28px rgba(0, 0, 0, 0.5), 0 0 12px rgba(59, 130, 246, 0.4)';
    });
    collapsedBtn.addEventListener('mouseleave', () => {
        collapsedBtn.style.transform = 'scale(1)';
        collapsedBtn.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.4)';
    });
    collapsedBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setUICollapsed(false);
    });

    // ฟังก์ชันควบคุมการพับ/ขยาย UI
    function setUICollapsed(collapsed) {
        localStorage.setItem('manga_ui_collapsed', collapsed ? 'true' : 'false');
        if (collapsed) {
            controlsRow.style.display = 'none';
            settingsPanel.style.display = 'none';
            collapsedBtn.style.display = 'flex';
            updateCollapsedIndicator();
        } else {
            collapsedBtn.style.display = 'none';
            controlsRow.style.display = 'flex';
        }
    }

    // ฟังก์ชันอัปเดตไฟสถานะการแปลบนปุ่มพับ
    function updateCollapsedIndicator() {
        const ind = document.getElementById('manga-collapsed-indicator');
        if (!ind) return;
        if (isTranslationEnabled) {
            ind.style.display = 'block';
            collapsedBtn.style.border = '1px solid rgba(59, 130, 246, 0.5)';
            collapsedBtn.style.boxShadow = '0 0 14px rgba(37, 99, 235, 0.4)';
        } else {
            ind.style.display = 'none';
            collapsedBtn.style.border = '1px solid rgba(255, 255, 255, 0.15)';
            collapsedBtn.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.4)';
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
        
        if (isTranslationEnabled) {
            startSequentialChapterTranslation();
        } else {
            stopSequentialChapterTranslation();
        }
    });

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
            startSequentialChapterTranslation();
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
        updateCollapsedIndicator();
    }

    container.appendChild(controlsRow);
    container.appendChild(collapsedBtn);
    container.appendChild(settingsPanel);
    document.body.appendChild(container);

    // ปิดหน้าต่างการตั้งค่าเมื่อคลิกข้างนอก
    document.addEventListener('click', (e) => {
        if (settingsPanel.style.display === 'flex' && !settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
            settingsPanel.style.display = 'none';
        }
    });

    // เรียกอัปเดตสถานะตอนเริ่มต้น
    updateUIState();
    updateLangPillsUI();

    // คืนสถานะพับเก็บตามที่บันทึกไว้ในเบราว์เซอร์
    const initialCollapsed = localStorage.getItem('manga_ui_collapsed') === 'true';
    setUICollapsed(initialCollapsed);
}



// ฟังก์ชันแปลง Blob เป็น Base64 Data URL
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const res = reader.result;
            if (typeof res === 'string' && res.startsWith('data:image/')) {
                resolve(res);
            } else {
                reject(new Error('Invalid DataURL format'));
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ฟังก์ชันแปลง base64 เป็น local blob URL เพื่อความเร็วสูงสุดและป้องกันการวนลูป DOM
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

// ฟังก์ชันดึงรูปภาพต้นฉบับอย่างปลอดภัย 100% (รองรับ Blob, CORS Bypass ผ่าน Background Service Worker & Userscript GM)
async function fetchMangaImageAsBase64(url, img) {
    // 0. หากมี base64 เดิมที่แคชไว้แล้ว
    if (img && img.dataset && img.dataset.originalDataUrl) {
        return img.dataset.originalDataUrl;
    }

    // 1. กรณีเป็น blob: URL ให้ลองดึงผ่าน Canvas หรือ fetch ตรงในคอนเท็กซ์เดียวกัน
    if (url.startsWith('blob:')) {
        if (img && img.complete && img.naturalWidth >= 200 && img.naturalHeight >= 200) {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                return canvas.toDataURL('image/jpeg', 0.90);
            } catch (e) {}
        }
        try {
            const resp = await fetch(url);
            const blob = await resp.blob();
            return await blobToDataUrl(blob);
        } catch (e) {}
    }

    // 2. กรณี Chrome Extension ให้ส่ง Background Service Worker ดึงข้าม Origin ได้ 100% ไร้ CORS
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
            const bgRes = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve(null), 25000);
                chrome.runtime.sendMessage({
                    action: 'fetch_image_base64',
                    url: url
                }, (response) => {
                    clearTimeout(timer);
                    if (chrome.runtime.lastError) {
                        resolve(null);
                    } else {
                        resolve(response);
                    }
                });
            });
            if (bgRes && bgRes.success && bgRes.data) {
                return bgRes.data;
            }
        } catch (bgErr) {
            console.warn('[Manga Translator] Background image fetch proxy error:', bgErr);
        }
    }

    // 3. กรณี Tampermonkey Userscript ให้ดึงผ่าน GM_xmlhttpRequest ไร้ CORS
    if (typeof GM_xmlhttpRequest !== 'undefined') {
        try {
            const gmRes = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    responseType: 'blob',
                    timeout: 25000,
                    onload: (res) => {
                        if (res.status >= 200 && res.status < 300) {
                            resolve(res.response);
                        } else {
                            reject(new Error(`HTTP ${res.status}`));
                        }
                    },
                    onerror: reject,
                    ontimeout: () => reject(new Error('GM fetch timeout'))
                });
            });
            if (gmRes) {
                return await blobToDataUrl(gmRes);
            }
        } catch (gmErr) {
            console.warn('[Manga Translator] GM_xmlhttpRequest image fetch error:', gmErr);
        }
    }

    // 4. วิธีสำรอง: ลอง fetch ตรง
    try {
        const resp = await fetch(url);
        if (resp.ok) {
            const blob = await resp.blob();
            return await blobToDataUrl(blob);
        }
    } catch (fetchErr) {}

    // 5. วิธีสำรองสุดท้าย: Canvas export
    if (img && img.complete && img.naturalWidth >= 200 && img.naturalHeight >= 200) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/jpeg', 0.88);
        } catch (canvasErr) {
            console.warn('[Manga Translator] Final canvas export fallback failed:', canvasErr);
        }
    }

    return null;
}

// 3. ฟังก์ชันแปลรูปภาพเดียวและบันทึกผลลงแอตทริบิวต์
async function startSingleImageTranslation(img) {
    let blurSafetyTimer = null;
    try {
        // ตรวจสอบรูปภาพอีกครั้งเพื่อความปลอดภัยสูงสุด
        if (typeof isNonMangaAsset === 'function' && isNonMangaAsset(img)) {
            img.dataset.mangaStatus = "ignored";
            img.style.filter = "none";
            return;
        }

        // ใส่เอฟเฟกต์เบลอเฉพาะหน้าที่กำลังถูกส่งแปลจริง ณ ขณะนี้
        img.style.transition = "filter 0.4s ease-in-out";
        img.style.filter = "blur(6px) grayscale(15%)";

        // Watchdog Safety Timer: ปลดเบลออัตโนมัติหากเกิน 35 วินาที ป้องกันหน้าเว็บค้างเบลอถาวรเด็ดขาด
        blurSafetyTimer = setTimeout(() => {
            if (img.dataset.mangaStatus !== "translated") {
                img.style.filter = "none";
            }
        }, 35000);

        const targetUrl = img.dataset.originalSrc || img.src;
        const base64Data = await fetchMangaImageAsBase64(targetUrl, img);

        if (!base64Data || !base64Data.startsWith('data:image/') || base64Data.startsWith('data:image/svg')) {
            console.warn('[Manga Translator] Skipping un-retrievable image payload:', targetUrl);
            img.dataset.mangaStatus = "error";
            img.dataset.mangaRetryTime = Date.now().toString();
            img.dataset.mangaRetryCount = (Number(img.dataset.mangaRetryCount) || 0) + 1;
            if (Number(img.dataset.mangaRetryCount) >= 2) {
                img.dataset.mangaStatus = "ignored";
            }
            img.style.filter = "none";
            return;
        }

        // บันทึกสำรองข้อมูลรูปต้นฉบับทั้งในรูปแบบ Data URL และ Local Blob URL
        if (!img.dataset.originalDataUrl) {
            img.dataset.originalDataUrl = base64Data;
        }
        if (!img.dataset.originalBlobUrl) {
            img.dataset.originalBlobUrl = base64ToBlobUrl(base64Data);
        }

        // ดึง URL ที่ผู้ใช้ตั้งค่าไว้ (รองรับการรันจากมือถือชี้มาที่ IP คอมพิวเตอร์หลัก)
        let serverUrl = localStorage.getItem('manga_api_url') || 'http://127.0.0.1:8000';
        serverUrl = serverUrl.trim();
        if (!/^https?:\/\//i.test(serverUrl)) {
            serverUrl = 'http://' + serverUrl;
        }
        const cleanServerUrl = serverUrl.replace(/\/$/, '');

        // ตรวจสอบโมเดลก่อนส่ง
        const currentModel = localStorage.getItem('manga_translation_model') || 'gemini';
        const requestPayload = { 
            image_base64: base64Data,
            source_lang: localStorage.getItem('manga_source_lang') || 'en',
            translation_model: currentModel
        };

        let data = null;

        // วิธีที่ 1: ส่งผ่าน Extension Background Service Worker (เลี่ยงปัญหา CSP, Mixed Content, Private Network 100%)
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            try {
                const bgRes = await new Promise((resolve) => {
                    const timer = setTimeout(() => {
                        console.warn('[Manga Translator] Background sendMessage timeout (35s)');
                        resolve(null);
                    }, 35000);

                    try {
                        chrome.runtime.sendMessage({
                            action: 'translate_base64',
                            url: `${cleanServerUrl}/translate_base64`,
                            data: requestPayload
                        }, (response) => {
                            clearTimeout(timer);
                            if (chrome.runtime.lastError) {
                                console.warn('[Manga Translator] chrome.runtime.lastError:', chrome.runtime.lastError.message);
                                resolve(null);
                            } else {
                                resolve(response);
                            }
                        });
                    } catch (sendErr) {
                        clearTimeout(timer);
                        resolve(null);
                    }
                });

                if (bgRes && bgRes.success && bgRes.data) {
                    data = bgRes.data;
                } else {
                    console.warn('[Manga Translator] Background translation reported error/timeout:', bgRes ? bgRes.error : 'No response');
                }
            } catch (bgErr) {
                console.warn('[Manga Translator] Background proxy attempt error:', bgErr);
            }
        } else if (typeof GM_xmlhttpRequest !== 'undefined') {
            // วิธีที่ 2: สำหรับ Tampermonkey / Userscript
            try {
                data = await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error('GM_xmlhttpRequest timeout (35s)')), 35000);
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: `${cleanServerUrl}/translate_base64`,
                        headers: { 'Content-Type': 'application/json' },
                        data: JSON.stringify(requestPayload),
                        timeout: 35000,
                        onload: (res) => {
                            clearTimeout(timer);
                            if (res.status >= 200 && res.status < 300) {
                                try {
                                    resolve(JSON.parse(res.responseText));
                                } catch (err) {
                                    reject(err);
                                }
                            } else {
                                reject(new Error(`Server status ${res.status}`));
                            }
                        },
                        ontimeout: () => {
                            clearTimeout(timer);
                            reject(new Error('GM_xmlhttpRequest timed out (35s)'));
                        },
                        onerror: (err) => {
                            clearTimeout(timer);
                            reject(err);
                        }
                    });
                });
            } catch (gmErr) {
                console.warn('[Manga Translator] GM_xmlhttpRequest attempt failed:', gmErr);
            }
        } else {
            // วิธีที่ 3: ส่งผ่าน fetch ตรง (เฉพาะเมื่อไม่อยู่ใน Extension หรือ Userscript)
            try {
                const controller = new AbortController();
                const fetchTimer = setTimeout(() => controller.abort(), 35000);
                const response = await fetch(`${cleanServerUrl}/translate_base64`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestPayload),
                    signal: controller.signal
                });
                clearTimeout(fetchTimer);

                if (response.ok) {
                    data = await response.json();
                } else {
                    console.warn(`[Manga Translator] Server responded with status ${response.status}`);
                }
            } catch (fetchErr) {
                console.warn('[Manga Translator] Direct fetch failed:', fetchErr);
            }
        }

        // หากผู้ใช้สลับโมเดลระหว่างส่งคำขอ ห้ามนำผลลัพธ์ของโมเดลเก่ามาแปะทับ
        if (localStorage.getItem('manga_translation_model') !== currentModel) {
            console.log('[Manga Translator] Ignored old model result after switch');
            return;
        }
        
        if (data && data.image) {
            // แปลง base64 ที่ได้รับจากเซิร์ฟเวอร์เป็น blob URL ชั่วคราวฝั่งเบราว์เซอร์
            const blobUrl = base64ToBlobUrl(data.image);
            img.dataset.translatedSrc = blobUrl;
            img.dataset.mangaStatus = "translated";
            img.style.filter = "none"; // เอาเอฟเฟกต์เบลอออกเมื่อแปลผลเรียบร้อย
            
            // เปลี่ยนรูปในหน้าจอหากผู้ใช้เปิดใช้งานการแปล
            if (isTranslationEnabled) {
                isInternalSrcChange = true;
                img.src = blobUrl;
                setTimeout(() => { isInternalSrcChange = false; }, 100);
            }
        } else {
            img.dataset.mangaStatus = "error";
            img.dataset.mangaRetryTime = Date.now().toString();
            img.dataset.mangaRetryCount = (Number(img.dataset.mangaRetryCount) || 0) + 1;
            if (Number(img.dataset.mangaRetryCount) >= 2) {
                img.dataset.mangaStatus = "ignored";
            }
            img.style.filter = "none";
        }

    } catch (e) {
        console.error("Translation error for", img.src, e);
        img.dataset.mangaStatus = "error";
        img.dataset.mangaRetryTime = Date.now().toString();
        img.dataset.mangaRetryCount = (Number(img.dataset.mangaRetryCount) || 0) + 1;
        if (Number(img.dataset.mangaRetryCount) >= 2) {
            img.dataset.mangaStatus = "ignored";
        }
        img.style.filter = "none";
    } finally {
        if (blurSafetyTimer) {
            clearTimeout(blurSafetyTimer);
        }
        // รับประกันการปลดเบลอเสมอในทุกกรณี
        if (img.dataset.mangaStatus !== "translated") {
            img.style.filter = "none";
        }
    }
}

// 4. ฟังก์ชันควบคุมการแสดงผลตามสถานะเปิด/ปิด
function updateOverlaysVisibility() {
    isInternalSrcChange = true;
    try {
        const images = document.querySelectorAll('img');
        images.forEach(img => {
            const hasTranslated = img.dataset.mangaStatus === "translated" || Boolean(img.dataset.translatedSrc);
            if (hasTranslated) {
                if (isTranslationEnabled) {
                    if (img.dataset.translatedSrc && img.src !== img.dataset.translatedSrc) {
                        img.src = img.dataset.translatedSrc;
                    }
                } else {
                    const original = img.dataset.originalBlobUrl || img.dataset.originalDataUrl || img.dataset.originalSrc;
                    if (original && img.src !== original) {
                        img.src = original;
                    }
                }
            }
            if (!isTranslationEnabled) {
                img.style.filter = "none";
                if (img.dataset.mangaStatus === "processing") {
                    const original = img.dataset.originalBlobUrl || img.dataset.originalDataUrl || img.dataset.originalSrc;
                    if (original && img.src !== original) {
                        img.src = original;
                    }
                }
            }
        });
    } finally {
        setTimeout(() => { isInternalSrcChange = false; }, 200);
    }
}

// เริ่มต้นรันระบบเมื่อหน้าเว็บโหลดเสร็จ (สร้างปุ่มลอยควบคุม)
createToggleUI();


