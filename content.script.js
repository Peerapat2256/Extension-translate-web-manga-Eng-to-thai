// เก็บสถานะเปิด/ปิดการแปลภาษา (เริ่มต้นเป็น false)
let isTranslationEnabled = false;
let isTranslatingLoopRunning = false;
let isInternalSrcChange = false;

// ฟังก์ชันดึง URL เซิร์ฟเวอร์ที่ใช้อยู่ (รองรับสลับ Local 127.0.0.1 กับ Cloud Server เช่น Render)
function getActiveServerUrl() {
    const source = localStorage.getItem('manga_backend_source') || 'local';
    let url = '';
    if (source === 'cloud') {
        url = (localStorage.getItem('manga_cloud_api_url') || '').trim();
        if (!url) {
            const fallback = (localStorage.getItem('manga_api_url') || '').trim();
            if (fallback && !fallback.includes('127.0.0.1') && !fallback.includes('localhost')) {
                url = fallback;
            }
        }
        if (!url) url = 'https://your-manga-server.onrender.com';
    } else {
        url = (localStorage.getItem('manga_local_api_url') || '').trim();
        if (!url) {
            const fallback = (localStorage.getItem('manga_api_url') || '').trim();
            if (fallback && (fallback.includes('127.0.0.1') || fallback.includes('localhost') || /^192\.168\./.test(fallback))) {
                url = fallback;
            }
        }
        if (!url) url = 'http://127.0.0.1:8000';
    }
    if (!/^https?:\/\//i.test(url)) {
        url = (source === 'cloud' ? 'https://' : 'http://') + url;
    }
    return url.replace(/\/$/, '');
}

// ตรวจสอบฟังก์ชันเครือข่ายสำหรับ Userscript (Tampermonkey, Safari Userscripts, Violentmonkey)
function getGmXhrFunction() {
    if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest;
    if (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function') return GM.xmlHttpRequest;
    if (typeof window !== 'undefined') {
        if (typeof window.GM_xmlhttpRequest === 'function') return window.GM_xmlhttpRequest;
        if (window.GM && typeof window.GM.xmlHttpRequest === 'function') return window.GM.xmlHttpRequest;
    }
    return null;
}

function isUserscriptEnvironment() {
    return getGmXhrFunction() !== null;
}

function isRealChromeExtension() {
    // หากพบ GM XHR แสดงว่ากำลังทำงานใน Userscript (Tampermonkey, Safari Userscripts) ห้ามใช้ chrome.runtime
    if (isUserscriptEnvironment()) return false;
    return (typeof chrome !== 'undefined' && 
            chrome.runtime && 
            typeof chrome.runtime.id === 'string' && 
            chrome.runtime.id.length > 0 && 
            typeof chrome.runtime.sendMessage === 'function');
}

function makeGmRequest(options) {
    return new Promise((resolve, reject) => {
        const gmFn = getGmXhrFunction();
        if (!gmFn) {
            return reject(new Error('GM XHR is not available in current environment'));
        }

        let settled = false;
        const timeoutMs = options.timeout || 35000;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new Error(`GM request timed out (${Math.round(timeoutMs / 1000)}s)`));
            }
        }, timeoutMs + 3000);

        const safeResolve = (val) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(val);
            }
        };

        const safeReject = (err) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(err);
            }
        };

        const config = {
            ...options,
            timeout: timeoutMs,
            onload: (res) => {
                if (options.onload) try { options.onload(res); } catch(e) {}
                safeResolve(res);
            },
            onerror: (err) => {
                if (options.onerror) try { options.onerror(err); } catch(e) {}
                safeReject(err);
            },
            ontimeout: () => {
                if (options.ontimeout) try { options.ontimeout(); } catch(e) {}
                safeReject(new Error('GM request ontimeout event fired'));
            }
        };

        try {
            const ret = gmFn(config);
            if (ret && typeof ret.then === 'function') {
                ret.then(safeResolve).catch(safeReject);
            }
        } catch (callErr) {
            safeReject(callErr);
        }
    });
}

// ระบบป้องกัน Render.com Free-Tier หลับ (Cold Start Waker & Toast Notifier)
let isCloudServerWakingUp = false;
let lastCloudWarmTimestamp = 0;
let cloudWakeToastElement = null;

function showCloudStatusToast(htmlContent, type = 'info') {
    if (!cloudWakeToastElement) {
        cloudWakeToastElement = document.createElement('div');
        cloudWakeToastElement.id = 'manga-cloud-toast';
        cloudWakeToastElement.style.cssText = `
            position: fixed;
            bottom: max(76px, calc(env(safe-area-inset-bottom, 16px) + 58px));
            right: max(16px, env(safe-area-inset-right, 16px));
            z-index: 99999999;
            background: rgba(15, 23, 42, 0.94);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            color: #f8fafc;
            border-radius: 10px;
            padding: 10px 14px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 11.5px;
            box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5), 0 0 15px rgba(56,189,248,0.25);
            border: 1px solid rgba(56, 189, 248, 0.4);
            display: flex;
            align-items: center;
            gap: 10px;
            transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
            max-width: min(340px, calc(100vw - 28px));
            box-sizing: border-box;
            line-height: 1.4;
        `;
        document.body.appendChild(cloudWakeToastElement);
    }

    cloudWakeToastElement.style.display = 'flex';
    cloudWakeToastElement.style.opacity = '1';

    let icon = '⚡';
    let borderColor = 'rgba(56, 189, 248, 0.5)';
    if (type === 'success') {
        icon = '🟢';
        borderColor = '#10b981';
    } else if (type === 'error') {
        icon = '🔴';
        borderColor = '#ef4444';
    } else if (type === 'cold_start') {
        icon = '⏳';
        borderColor = '#f59e0b';
    }

    cloudWakeToastElement.style.borderColor = borderColor;
    cloudWakeToastElement.innerHTML = `<span style="font-size: 17px; flex-shrink: 0;">${icon}</span><div>${htmlContent}</div>`;

    if (type === 'success' || type === 'error') {
        setTimeout(() => {
            if (cloudWakeToastElement) {
                cloudWakeToastElement.style.opacity = '0';
                setTimeout(() => { if (cloudWakeToastElement) cloudWakeToastElement.style.display = 'none'; }, 400);
            }
        }, type === 'success' ? 3500 : 6000);
    }
}

async function warmUpCloudServer(force = false) {
    const source = localStorage.getItem('manga_backend_source') || 'local';
    if (source !== 'cloud') return true;

    // หากเพิ่งเช็คความพร้อมมาไม่เกิน 8 นาที ไม่ต้องยิงซ้ำ
    if (!force && lastCloudWarmTimestamp && (Date.now() - lastCloudWarmTimestamp < 8 * 60 * 1000)) {
        return true;
    }

    if (isCloudServerWakingUp) return false;
    isCloudServerWakingUp = true;

    const targetUrl = getActiveServerUrl();
    const tStart = Date.now();

    // แสดง Toast แจ้งเตือนเมื่อใช้เวลาเกิน 2.2 วินาที (หมายถึง Render กำลังบูต Cold Start อยู่)
    const slowTimer = setTimeout(() => {
        showCloudStatusToast(
            '<b>กำลังปลุก Cloud Server บน Render...</b><div style="font-size:10px; color:#94a3b8; margin-top:2px;">(Cold Start ~30-50 วินาที) มังงะจะเริ่มแปลอัตโนมัติทันทีที่เซิร์ฟเวอร์พร้อมครับ</div>',
            'cold_start'
        );
        const mainBtnText = document.querySelector('#manga-translator-btn span:last-child');
        if (mainBtnText && isTranslationEnabled) {
            mainBtnText.innerText = '⏳ กำลังปลุกเซิร์ฟเวอร์ Render (~30-50s)...';
        }
    }, 2200);

    let isOk = false;
    let detail = '';

    try {
        if (isRealChromeExtension()) {
            const res = await new Promise(r => {
                chrome.runtime.sendMessage({ action: 'fetch_json', url: `${targetUrl}/health`, timeout: 65000 }, resp => r(resp));
                setTimeout(() => r(null), 65000);
            });
            if (res && res.success && res.data) {
                isOk = true;
                detail = res.data.engine || res.data.status || 'Online';
            }
        }
        if (!isOk && isUserscriptEnvironment()) {
            try {
                const gmRes = await makeGmRequest({
                    method: 'GET',
                    url: `${targetUrl}/health`,
                    headers: { 'Accept': 'application/json' },
                    timeout: 65000
                });
                if (gmRes && gmRes.responseText) {
                    try {
                        const parsed = JSON.parse(gmRes.responseText);
                        if (parsed && (parsed.status === 'online' || parsed.status === 'ok' || parsed.engine)) {
                            isOk = true;
                            detail = parsed.engine || parsed.status || 'Online';
                        }
                    } catch(e) {}
                }
            } catch (e) {}
        }
        if (!isOk) {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 65000);
            const resp = await fetch(`${targetUrl}/health`, { signal: controller.signal });
            clearTimeout(tid);
            if (resp.ok) {
                isOk = true;
                const json = await resp.json();
                detail = json.engine || json.status || 'Online';
            }
        }
    } catch (err) {
        console.warn('[Manga Translator] warmUpCloudServer ping error:', err);
    } finally {
        clearTimeout(slowTimer);
        isCloudServerWakingUp = false;
    }

    const elapsed = Date.now() - tStart;
    if (isOk) {
        lastCloudWarmTimestamp = Date.now();
        if (elapsed > 2200) {
            showCloudStatusToast(
                `<b>เซิร์ฟเวอร์ Render ตื่นแล้ว! (${Math.round(elapsed / 1000)}s)</b><div style="font-size:10px; color:#86efac;">พร้อมแปลมังงะทันทีครับ</div>`,
                'success'
            );
        }
        wakeSupervisor();
        return true;
    } else {
        if (elapsed > 2200) {
            showCloudStatusToast(
                '<b>ไม่สามารถปลุกเซิร์ฟเวอร์ได้</b><div style="font-size:10px; color:#fca5a5;">โปรดตรวจสอบ URL ของ Render หรือดูสถานะเซิร์ฟเวอร์</div>',
                'error'
            );
        }
        return false;
    }
}

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
        if (img.closest('#manga-translator-ui-container, header, footer, nav, aside, .comment, .comments, #comments, .disqus, .sidebar, .menu, .ad-container, .adsbygoogle')) {
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

    if (mangaImgs.length <= 1) return mangaImgs;

    // คำนวณตำแหน่ง top เพียงครั้งเดียวต่อรูป (Single Layout Pass) เพื่อป้องกัน Layout Thrashing และอาการหน้าเว็บค้าง
    const scrollY = window.scrollY;
    const items = mangaImgs.map(img => ({
        img,
        top: img.getBoundingClientRect().top + scrollY
    }));

    items.sort((a, b) => a.top - b.top);
    return items.map(item => item.img);
}

// หาตำแหน่งหน้าที่ผู้ใช้กำลังอ่านอยู่ตามตำแหน่งการเลื่อนจอ (Current Viewport Reading Index)
function findCurrentReadingIndex(images) {
    if (!images || images.length === 0) return 0;

    // หากแท็บถูกพับไปเบื้องหลัง ไม่ต้องคำนวณตำแหน่ง Layout เพื่อลดภาระเบราว์เซอร์
    if (document.hidden) {
        for (let i = 0; i < images.length; i++) {
            if (images[i].dataset.mangaStatus !== "translated" && images[i].dataset.mangaStatus !== "ignored") {
                return i;
            }
        }
        return 0;
    }

    const viewTop = window.scrollY;
    const viewMid = viewTop + (window.innerHeight * 0.35);

    let bestIdx = 0;
    let minDistance = Infinity;

    for (let i = 0; i < images.length; i++) {
        const rect = images[i].getBoundingClientRect();
        const imgTop = rect.top + viewTop;
        const imgBottom = rect.bottom + viewTop;

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
let domMutationTimeout = null;
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
            // หากแท็บถูกพับไปเบื้องหลัง (Background Tab) หน่วงเวลาเพื่อประหยัด CPU และไม่ให้เบราว์เซอร์ตัดการทำงาน
            if (document.hidden) {
                await sleepOrWake(800);
                if (!isTranslationEnabled) break;
            }

            // หากเซิร์ฟเวอร์ Cloud กำลังตื่น (Cold Start) ให้รอจนกว่าจะตื่นเสร็จ เพื่อไม่ให้ส่งรูปไปค้าง
            if (isCloudServerWakingUp) {
                const textSpan = document.querySelector('#manga-translator-btn span:last-child');
                if (textSpan && isTranslationEnabled) {
                    textSpan.innerText = '⏳ กำลังปลุกเซิร์ฟเวอร์ Render (Cold Start)...';
                }
                await sleepOrWake(1500);
                continue;
            }

            const mangaImages = getSortedMangaImages();
            if (mangaImages.length === 0) {
                await sleepOrWake(800);
                continue;
            }

            // รับประกันว่าหน้าที่แปลเสร็จแล้วทั้งหมดแสดงผลรูปแปลเสมอ (ป้องกันเว็บ reader ดึงต้นฉบับมาทับ)
            for (let i = 0; i < mangaImages.length; i++) {
                const img = mangaImages[i];
                if (img.dataset.mangaStatus === "translated") {
                    let transSrc = img.dataset.translatedSrc;
                    if (!transSrc && img.dataset.translatedDataUrl) {
                        transSrc = base64ToBlobUrl(img.dataset.translatedDataUrl);
                        img.dataset.translatedSrc = transSrc;
                    }
                    if (transSrc && img.src !== transSrc) {
                        if (img.srcset) {
                            if (!img.dataset.originalSrcset) img.dataset.originalSrcset = img.srcset;
                            img.removeAttribute('srcset');
                        }
                        isInternalSrcChange = true;
                        img.src = transSrc;
                        setTimeout(() => { isInternalSrcChange = false; }, 100);
                    }
                }
            }

            // 1. หาตำแหน่งหน้าที่ผู้ใช้อ่านอยู่จริง ณ ขณะนี้ (Viewport Reading Index)
            const currIdx = findCurrentReadingIndex(mangaImages);

            // 2. กระตุ้นให้เบราว์เซอร์ดาวน์โหลดภาพใกล้สายตาล่วงหน้า (เฉพาะเมื่อเปิดดูแท็บ)
            if (!document.hidden) {
                for (let i = currIdx; i < Math.min(mangaImages.length, currIdx + 6); i++) {
                    const img = mangaImages[i];
                    if (img.loading === 'lazy') img.loading = 'eager';
                    if (img.hasAttribute('loading')) img.removeAttribute('loading');
                }

                // 3. ใส่เอฟเฟกต์เบลอเฉพาะหน้าที่โหลดเสร็จแล้วและอยู่ในระยะสายตา + ถัดไป (ที่ยังไม่ได้แปล)
                for (let i = currIdx; i < Math.min(mangaImages.length, currIdx + 5); i++) {
                    const img = mangaImages[i];
                    if (img.dataset.mangaStatus !== "translated" && img.dataset.mangaStatus !== "processing") {
                        if (isImageLoadedAndReady(img) && !img.dataset.mangaBlurred) {
                            img.dataset.mangaBlurred = "true";
                            img.style.transition = "filter 0.4s ease-in-out";
                            img.style.filter = "blur(6px) grayscale(15%)";
                        }
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
                    const msg = (translatedCount >= mangaImages.length)
                        ? `แปลครบทุกหน้าแล้ว (${mangaImages.length} หน้า)`
                        : `พร้อมอ่าน (แปลแล้ว ${translatedCount}/${mangaImages.length} หน้า - เลื่อนลงเพื่อแปลต่อ)`;
                    if (textSpan.innerText !== msg) {
                        textSpan.innerText = msg;
                    }
                }
                // พักรอจนกว่าผู้ใช้จะเลื่อนจอ หรือเว็บจะโหลดภาพถัดไปเพิ่ม
                await sleepOrWake(document.hidden ? 1200 : 400);
                continue;
            }

            const targetImg = target.img;
            const targetIdx = target.index;

            // 5. อัปเดตสถานะปุ่มลอย แสดงความคืบหน้าแบบ Real-Time (อัปเดตเฉพาะเมื่อข้อความเปลี่ยนจริง)
            const textSpan = document.querySelector('#manga-translator-btn span:last-child');
            if (textSpan && isTranslationEnabled) {
                const msg = `กำลังแปลหน้า ${targetIdx + 1}/${mangaImages.length} (โหลดแล้ว ${loadedCount} หน้า)...`;
                if (textSpan.innerText !== msg) {
                    textSpan.innerText = msg;
                }
            }

            // 6. ส่งแปลภาพนี้ทันที (มั่นใจได้ 100% ว่าภาพพร้อม ไม่มีบัคค้าง)
            targetImg.dataset.mangaStatus = "processing";
            delete targetImg.dataset.mangaBlurred;
            await startSingleImageTranslation(targetImg);
            targetImg.style.filter = "none";

            // สลับไปหน้าถัดไปทันที (ให้ Event Loop หายใจ ป้องกันหน้าจอค้าง)
            await new Promise(r => setTimeout(r, document.hidden ? 300 : 100));
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
        if (isTranslationEnabled && !document.hidden) {
            wakeSupervisor();
            if (!isTranslatingLoopRunning) {
                translationSupervisorLoop();
            }
        }
    }, 120);
}

// ตรวจจับเมื่อผู้ใช้สลับแท็บเข้า-ออก (Visibility Change Lifecycle)
function handleTabVisibilityChange() {
    if (!isTranslationEnabled) return;
    if (!document.hidden) {
        // เมื่อผู้ใช้สลับกลับมาที่แท็บ ให้ปลุก supervisor ทันทีอย่างนุ่มนวล
        setTimeout(() => {
            if (isTranslationEnabled) {
                wakeSupervisor();
                if (!isTranslatingLoopRunning) {
                    translationSupervisorLoop();
                }
            }
        }, 150);
    }
}

// ตั้งค่า MutationObserver ตรวจจับภาพใหม่ พร้อมระบบกรองและ Debounce ป้องกัน Infinite Loop 100%
function setupMutationObserver() {
    if (domMutationObserver) return;

    domMutationObserver = new MutationObserver((mutations) => {
        if (!isTranslationEnabled || isInternalSrcChange) return;

        // ถ้าแท็บอยู่ในพื้นหลัง (document.hidden) ให้เบราว์เซอร์ทำงานเบาที่สุด ไม่ต้องปลุกทันที
        if (document.hidden) return;

        // กรองการเปลี่ยนแปลงที่เกิดจาก UI หรือ Toast ของตัวส่วนขยายเอง
        let hasRelevantChange = false;
        for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            const target = m.target;
            if (target && target.nodeType === 1) {
                if (target.id === 'manga-translator-ui-container' ||
                    (target.closest && target.closest('#manga-translator-ui-container')) ||
                    target.id === 'manga-cloud-toast' ||
                    target.id === 'manga-translator-responsive-style') {
                    continue;
                }
            }
            hasRelevantChange = true;
            break;
        }

        if (!hasRelevantChange) return;

        // Debounce 400ms ป้องกันการยิงคำขอซ้ำรัวๆ
        clearTimeout(domMutationTimeout);
        domMutationTimeout = setTimeout(() => {
            if (isTranslationEnabled && !document.hidden) {
                wakeSupervisor();
            }
        }, 400);
    });

    domMutationObserver.observe(document.body, { 
        childList: true, 
        subtree: true,
        attributes: false
    });
}

// เริ่มต้นระบบแปลอัตโนมัติตามหน้าที่เว็บโหลดไว้
async function startSequentialChapterTranslation() {
    window.removeEventListener('scroll', handleReadingScroll);
    window.addEventListener('scroll', handleReadingScroll, { passive: true });

    document.removeEventListener('visibilitychange', handleTabVisibilityChange);
    document.addEventListener('visibilitychange', handleTabVisibilityChange);

    // คืนรูปแปลทันทีสำหรับหน้าที่เคยแปลเสร็จแล้ว (Instant Fast Switch)
    updateOverlaysVisibility();

    // ตรวจจับเมื่อเว็บโหลดภาพใหม่เข้ามาใน DOM
    setupMutationObserver();

    // หากใช้ Cloud Server ให้เริ่มปลุกเซิร์ฟเวอร์แบบเบื้องหลังทันที
    if (localStorage.getItem('manga_backend_source') === 'cloud') {
        warmUpCloudServer();
    }

    await translationSupervisorLoop();
}

// ฟังก์ชันหยุดและกู้คืนรูปต้นฉบับทั้งหมดทันทีเมื่อผู้ใช้กดปิด (ดูต้นฉบับ)
function stopSequentialChapterTranslation() {
    window.removeEventListener('scroll', handleReadingScroll);
    document.removeEventListener('visibilitychange', handleTabVisibilityChange);
    if (domMutationObserver) {
        domMutationObserver.disconnect();
        domMutationObserver = null;
    }
    clearTimeout(domMutationTimeout);
    isTranslatingLoopRunning = false;
    clearTimeout(scrollDebounceTimer);
    wakeSupervisor();
    
    // สลับทุกรูปกลับเป็นต้นฉบับทันที
    updateOverlaysVisibility();

    const textSpan = document.querySelector('#manga-translator-btn span:last-child');
    if (textSpan) {
        const mangaImages = getSortedMangaImages();
        const translatedCount = mangaImages.filter(img => img.dataset.mangaStatus === "translated").length;
        if (translatedCount > 0) {
            textSpan.innerText = `ดูแบบแปล (แปลแล้ว ${translatedCount}/${mangaImages.length} หน้า)`;
        } else {
            textSpan.innerText = 'แปลหน้านี้ (Translate Page)';
        }
    }
}

// ฟังก์ชันล้าง/รีเซ็ตการแปลทั้งหมด
function resetTranslations() {
    window.removeEventListener('scroll', handleReadingScroll);
    document.removeEventListener('visibilitychange', handleTabVisibilityChange);
    if (domMutationObserver) {
        domMutationObserver.disconnect();
        domMutationObserver = null;
    }
    clearTimeout(domMutationTimeout);
    isTranslatingLoopRunning = false;
    clearTimeout(scrollDebounceTimer);
    wakeSupervisor();
    
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        if (img.dataset.mangaStatus && img.dataset.mangaStatus !== "ignored") {
            delete img.dataset.mangaStatus;
            delete img.dataset.mangaBlurred;
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

    // ========== Responsive CSS Injection ==========
    if (!document.getElementById('manga-translator-responsive-style')) {
        const responsiveStyle = document.createElement('style');
        responsiveStyle.id = 'manga-translator-responsive-style';
        responsiveStyle.textContent = `
            /* ===== Tablet & Small Desktop (≤768px) ===== */
            @media (max-width: 768px) {
                #manga-translator-ui-container {
                    bottom: max(12px, env(safe-area-inset-bottom, 12px)) !important;
                    right: max(10px, env(safe-area-inset-right, 10px)) !important;
                }
                #manga-translator-ui {
                    gap: 8px !important;
                    padding: 5px 10px !important;
                }
                #manga-translator-btn {
                    padding: 6px 10px !important;
                    font-size: 12px !important;
                }
                #manga-translator-btn svg {
                    width: 16px !important;
                    height: 16px !important;
                }
                #manga-model-select {
                    max-width: 140px !important;
                    font-size: 10px !important;
                }
                #manga-translator-settings {
                    width: min(310px, calc(100vw - 24px)) !important;
                    max-height: min(70vh, 480px) !important;
                    overflow-y: auto !important;
                    box-sizing: border-box !important;
                }
            }

            /* ===== Mobile (≤480px) ===== */
            @media (max-width: 480px) {
                #manga-translator-ui-container {
                    bottom: max(8px, env(safe-area-inset-bottom, 8px)) !important;
                    right: max(6px, env(safe-area-inset-right, 6px)) !important;
                    left: max(6px, env(safe-area-inset-left, 6px)) !important;
                    align-items: stretch !important;
                }
                #manga-translator-ui {
                    gap: 6px !important;
                    padding: 5px 8px !important;
                    border-radius: 14px !important;
                    flex-wrap: wrap !important;
                    justify-content: center !important;
                }
                #manga-translator-btn {
                    padding: 6px 8px !important;
                    font-size: 11px !important;
                    gap: 5px !important;
                }
                #manga-translator-btn > span:last-child {
                    display: none !important;
                }
                #manga-model-select {
                    display: none !important;
                }
                #manga-translator-settings {
                    width: calc(100vw - 16px) !important;
                    max-height: min(60vh, 400px) !important;
                    overflow-y: auto !important;
                    border-radius: 14px !important;
                    box-sizing: border-box !important;
                }
                #manga-collapsed-btn {
                    width: 48px !important;
                    height: 48px !important;
                }
                #manga-cloud-toast {
                    right: 6px !important;
                    left: 6px !important;
                    max-width: none !important;
                }
            }

            /* ===== Very Small (≤360px) ===== */
            @media (max-width: 360px) {
                #manga-translator-ui {
                    gap: 4px !important;
                    padding: 4px 6px !important;
                }
                #manga-translator-btn {
                    padding: 5px 6px !important;
                }
            }

            /* ===== Smooth scrollbar for settings panel ===== */
            #manga-translator-settings::-webkit-scrollbar {
                width: 4px;
            }
            #manga-translator-settings::-webkit-scrollbar-track {
                background: transparent;
            }
            #manga-translator-settings::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.15);
                border-radius: 4px;
            }
            #manga-translator-settings::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.3);
            }
        `;
        document.head.appendChild(responsiveStyle);
    }

    // ตั้งค่าเริ่มต้น manga_source_lang ใน localStorage ถ้าไม่มี
    if (!localStorage.getItem('manga_source_lang')) {
        localStorage.setItem('manga_source_lang', 'en');
    }

    const container = document.createElement('div');
    container.id = 'manga-translator-ui-container';
    container.style.cssText = `
        position: fixed;
        bottom: max(24px, env(safe-area-inset-bottom, 24px));
        right: max(24px, env(safe-area-inset-right, 24px));
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
        { value: 'google_translate', label: '🌐 Google Translate (ความเร็วแสง 0.2 วิ - เสถียรสุด)' },
        { value: 'gemini', label: '✨ Gemini: 🔄 Auto Cascade (9 รุ่น สลับอัตโนมัติ - 13,500 หน้า/วัน)' },
        { value: 'gemini:gemini-3.5-flash-lite', label: '⚡ Gemini 3.5 Flash-Lite (เร็วจัด ~0.8s - เบา ประหยัดโควต้า)' },
        { value: 'gemini:gemini-flash-lite-latest', label: '⚡ Gemini Flash-Lite Latest (เร็วมาก ~0.9s - สำนวนการ์ตูนมันส์)' },
        { value: 'gemini:gemini-3.1-flash-lite', label: '⚡ Gemini 3.1 Flash-Lite (เสถียร ~1.2s - น้ำหนักเบา)' },
        { value: 'gemini:gemini-3-flash-preview', label: '✨ Gemini 3 Flash Preview (สปีดแฟลช ~3.2s - แม่นยำ)' },
        { value: 'gemini:gemini-3.8-flash', label: '✨ Gemini 3.8 Flash (สเปกสูง ~4.1s - รูปประโยคยาก)' },
        { value: 'gemini:gemini-flash-latest', label: '✨ Gemini Flash Latest (ฉลาดสมดุล ~4.3s - แนะนำ)' },
        { value: 'gemini:gemini-3.6-flash', label: '✨ Gemini 3.6 Flash (คมชัดละเอียด ~5.9s - เจเนอเรชันใหม่)' },
        { value: 'gemini:gemini-2.5-flash', label: '✨ Gemini 2.5 Flash (คลาสสิก ~8.4s - ละเอียดลึกซึ้ง)' },
        { value: 'gemini:gemini-3.5-flash', label: '✨ Gemini 3.5 Flash (บริบทสูงสุด ~12.9s - เนื้อเรื่องเข้มข้น)' },
        { value: 'local_qwen25', label: '💻 Local AI: Qwen 2.5 3B (เร็วเบา 1-2 วิ - ออฟไลน์)' },
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
        width: min(310px, calc(100vw - 32px));
        max-height: min(75vh, 520px);
        overflow-y: auto;
        box-sizing: border-box;
        font-family: inherit;
        color: #f8fafc;
    `;

    // ส่วนตั้งค่าระบบประมวลผล (OCR & Vision Engine Mode)
    const engineTitle = document.createElement('div');
    engineTitle.style.cssText = `
        font-size: 11px;
        font-weight: 700;
        color: #38bdf8;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        display: flex;
        align-items: center;
        gap: 6px;
    `;
    engineTitle.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> ระบบประมวลผล (Engine)`;
    settingsPanel.appendChild(engineTitle);

    const engineSelect = document.createElement('select');
    engineSelect.id = 'manga-engine-mode-select';
    engineSelect.style.cssText = `
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(56, 189, 248, 0.35);
        border-radius: 6px;
        padding: 6px 8px;
        color: #f8fafc;
        font-size: 11px;
        font-weight: 600;
        outline: none;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.2s;
    `;

    const engineOptions = [
        { value: 'vision', label: '✨ Gemini Multimodal Vision (สเตเบิล / แนะนำ - สวยงามคมชัด)' },
        { value: 'offline_ocr', label: '🖥️ ระบบเดิม: Offline OCR ในเครื่อง (Comic-Text + EasyOCR)' }
    ];

    engineOptions.forEach(optData => {
        const opt = document.createElement('option');
        opt.value = optData.value;
        opt.innerText = optData.label;
        opt.style.background = '#0f172a';
        opt.style.color = '#f8fafc';
        engineSelect.appendChild(opt);
    });

    if (!localStorage.getItem('manga_engine_mode')) {
        localStorage.setItem('manga_engine_mode', 'vision');
    }
    engineSelect.value = localStorage.getItem('manga_engine_mode') || 'vision';

    engineSelect.addEventListener('change', () => {
        const newEngine = engineSelect.value;
        localStorage.setItem('manga_engine_mode', newEngine);
        console.log('[Manga Translator] Switched engine mode to:', newEngine);
        resetTranslations();
        if (isTranslationEnabled) {
            startSequentialChapterTranslation();
        }
    });
    settingsPanel.appendChild(engineSelect);

    const engineDivider = document.createElement('div');
    engineDivider.style.cssText = `
        width: 100%;
        height: 1px;
        background: rgba(255, 255, 255, 0.12);
        margin: 4px 0;
    `;
    settingsPanel.appendChild(engineDivider);

    // ส่วนตั้งค่าแหล่งที่มาเซิร์ฟเวอร์ (Local vs Cloud Render)
    const urlContainer = document.createElement('div');
    urlContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 6px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        padding: 8px;
    `;

    const settingsTitle = document.createElement('div');
    settingsTitle.style.cssText = `
        font-size: 11px;
        font-weight: 700;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        display: flex;
        align-items: center;
        gap: 5px;
    `;
    settingsTitle.innerHTML = `<span>🌐</span> เซิร์ฟเวอร์ประมวลผล (Backend Source)`;
    urlContainer.appendChild(settingsTitle);

    // แท็บสลับ Local vs Cloud
    const sourceToggle = document.createElement('div');
    sourceToggle.style.cssText = `
        display: flex;
        background: rgba(0, 0, 0, 0.35);
        border-radius: 6px;
        padding: 2px;
        gap: 3px;
        border: 1px solid rgba(255, 255, 255, 0.06);
    `;

    const localBtn = document.createElement('div');
    localBtn.style.cssText = `
        flex: 1;
        text-align: center;
        padding: 5px 8px;
        font-size: 10px;
        font-weight: 600;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
    `;
    localBtn.innerHTML = `🖥️ Local (ในเครื่อง)`;

    const cloudBtn = document.createElement('div');
    cloudBtn.style.cssText = `
        flex: 1;
        text-align: center;
        padding: 5px 8px;
        font-size: 10px;
        font-weight: 600;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
    `;
    cloudBtn.innerHTML = `☁️ Cloud (Render / URL)`;

    sourceToggle.appendChild(localBtn);
    sourceToggle.appendChild(cloudBtn);
    urlContainer.appendChild(sourceToggle);

    // Label คำอธิบาย URL
    const urlLabel = document.createElement('div');
    urlLabel.style.cssText = `
        font-size: 10px;
        color: #94a3b8;
        line-height: 1.2;
    `;
    urlContainer.appendChild(urlLabel);

    // กล่องพิมพ์ URL
    const ipInput = document.createElement('input');
    ipInput.type = 'text';
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
    urlContainer.appendChild(ipInput);

    // แถวปุ่มทดสอบและปุ่มบันทึก
    const actionsRow = document.createElement('div');
    actionsRow.style.cssText = `
        display: flex;
        gap: 6px;
    `;

    const testBtn = document.createElement('div');
    testBtn.style.cssText = `
        flex: 1;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.18);
        color: #e2e8f0;
        border-radius: 6px;
        padding: 6px 4px;
        font-size: 10.5px;
        font-weight: 600;
        cursor: pointer;
        text-align: center;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
    `;
    testBtn.innerHTML = `⚡ ตรวจสอบเชื่อมต่อ`;

    const saveBtn = document.createElement('div');
    saveBtn.style.cssText = `
        flex: 1;
        background: linear-gradient(135deg, #2563eb, #7c3aed);
        color: #ffffff;
        border-radius: 6px;
        padding: 6px 4px;
        font-size: 10.5px;
        font-weight: 600;
        cursor: pointer;
        text-align: center;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
    `;
    saveBtn.innerHTML = `💾 บันทึก (Save)`;

    actionsRow.appendChild(testBtn);
    actionsRow.appendChild(saveBtn);
    urlContainer.appendChild(actionsRow);

    // ป้ายแสดงผลการทดสอบ (Status Badge)
    const statusBadge = document.createElement('div');
    statusBadge.style.cssText = `
        display: none;
        font-size: 10px;
        padding: 5px 8px;
        border-radius: 4px;
        text-align: center;
        font-weight: 600;
        line-height: 1.3;
    `;
    urlContainer.appendChild(statusBadge);

    settingsPanel.appendChild(urlContainer);

    let currentSource = localStorage.getItem('manga_backend_source') || 'local';
    let savedLocalUrl = localStorage.getItem('manga_local_api_url') || 'http://127.0.0.1:8000';
    let savedCloudUrl = localStorage.getItem('manga_cloud_api_url') || '';

    function updateSourceUI() {
        if (currentSource === 'cloud') {
            cloudBtn.style.background = 'linear-gradient(135deg, #38bdf8, #2563eb)';
            cloudBtn.style.color = '#ffffff';
            cloudBtn.style.boxShadow = '0 2px 8px rgba(37, 99, 235, 0.4)';
            localBtn.style.background = 'transparent';
            localBtn.style.color = '#94a3b8';
            localBtn.style.boxShadow = 'none';
            
            urlLabel.innerText = 'URL ของ Render หรือ Cloud Server (HTTPS):';
            ipInput.placeholder = 'https://your-manga-server.onrender.com';
            ipInput.value = savedCloudUrl || (localStorage.getItem('manga_api_url') && !localStorage.getItem('manga_api_url').includes('127.0.0.1') ? localStorage.getItem('manga_api_url') : '');
        } else {
            localBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
            localBtn.style.color = '#ffffff';
            localBtn.style.boxShadow = '0 2px 8px rgba(16, 185, 129, 0.4)';
            cloudBtn.style.background = 'transparent';
            cloudBtn.style.color = '#94a3b8';
            cloudBtn.style.boxShadow = 'none';

            urlLabel.innerText = 'URL ของเครื่องคอมพิวเตอร์ (Local IP / Port 8000):';
            ipInput.placeholder = 'http://127.0.0.1:8000';
            ipInput.value = savedLocalUrl;
        }
    }

    localBtn.addEventListener('click', () => {
        currentSource = 'local';
        localStorage.setItem('manga_backend_source', 'local');
        updateSourceUI();
        statusBadge.style.display = 'none';
    });

    cloudBtn.addEventListener('click', () => {
        currentSource = 'cloud';
        localStorage.setItem('manga_backend_source', 'cloud');
        updateSourceUI();
        statusBadge.style.display = 'none';
    });

    updateSourceUI();

    // ปุ่มบันทึกการตั้งค่า
    saveBtn.addEventListener('click', () => {
        let val = ipInput.value.trim();
        if (!val) {
            val = currentSource === 'cloud' ? 'https://your-manga-server.onrender.com' : 'http://127.0.0.1:8000';
        }
        if (!/^https?:\/\//i.test(val)) {
            val = (currentSource === 'cloud' ? 'https://' : 'http://') + val;
        }
        val = val.replace(/\/$/, '');

        if (currentSource === 'cloud') {
            savedCloudUrl = val;
            localStorage.setItem('manga_cloud_api_url', val);
        } else {
            savedLocalUrl = val;
            localStorage.setItem('manga_local_api_url', val);
        }
        localStorage.setItem('manga_api_url', val);

        saveBtn.innerText = '✓ บันทึกแล้ว!';
        saveBtn.style.background = '#10b981';
        
        fetchAndRenderGeminiQuota();
        resetTranslations();
        if (isTranslationEnabled) startSequentialChapterTranslation();

        setTimeout(() => {
            saveBtn.innerHTML = `💾 บันทึก (Save)`;
            saveBtn.style.background = 'linear-gradient(135deg, #2563eb, #7c3aed)';
            settingsPanel.style.display = 'none';
        }, 800);
    });

    // ปุ่มทดสอบการเชื่อมต่อ (Ping)
    testBtn.addEventListener('click', async () => {
        statusBadge.style.display = 'block';
        statusBadge.style.background = 'rgba(255, 255, 255, 0.08)';
        statusBadge.style.border = '1px solid rgba(255, 255, 255, 0.15)';
        statusBadge.style.color = '#cbd5e1';
        statusBadge.innerText = '⏳ กำลังทดสอบเชื่อมต่อ...';

        let targetUrl = ipInput.value.trim() || (currentSource === 'cloud' ? savedCloudUrl : savedLocalUrl);
        if (!targetUrl) targetUrl = (currentSource === 'cloud' ? 'https://your-manga-server.onrender.com' : 'http://127.0.0.1:8000');
        if (!/^https?:\/\//i.test(targetUrl)) {
            targetUrl = (currentSource === 'cloud' ? 'https://' : 'http://') + targetUrl;
        }
        targetUrl = targetUrl.replace(/\/$/, '');

        const tStart = Date.now();
        let isOk = false;
        let detail = '';

        const isCloudTarget = (currentSource === 'cloud');
        const testTimeout = isCloudTarget ? 65000 : 8000;

        let coldTimer = null;
        if (isCloudTarget) {
            coldTimer = setTimeout(() => {
                statusBadge.style.background = 'rgba(245, 158, 11, 0.2)';
                statusBadge.style.border = '1px solid #f59e0b';
                statusBadge.style.color = '#fbbf24';
                statusBadge.innerText = '⏳ กำลังปลุกเซิร์ฟเวอร์ Render (Cold Start อาจใช้เวลา 30-50 วิ)...';
            }, 2500);
        }

        try {
            if (isRealChromeExtension()) {
                const res = await new Promise(r => {
                    chrome.runtime.sendMessage({ action: 'fetch_json', url: `${targetUrl}/health`, timeout: testTimeout }, resp => r(resp));
                    setTimeout(() => r(null), testTimeout);
                });
                if (res && res.success && res.data) {
                    isOk = true;
                    detail = res.data.engine || res.data.status || 'Online';
                }
            }
            if (!isOk && isUserscriptEnvironment()) {
                try {
                    const gmRes = await makeGmRequest({
                        method: 'GET',
                        url: `${targetUrl}/health`,
                        headers: { 'Accept': 'application/json' },
                        timeout: testTimeout
                    });
                    if (gmRes && gmRes.responseText) {
                        try {
                            const parsed = JSON.parse(gmRes.responseText);
                            if (parsed && (parsed.status === 'online' || parsed.status === 'ok' || parsed.engine)) {
                                isOk = true;
                                detail = parsed.engine || parsed.status || 'Online';
                            }
                        } catch(e) {}
                    }
                } catch (e) {}
            }
            if (!isOk) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), testTimeout);
                const resp = await fetch(`${targetUrl}/health`, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (resp.ok) {
                    isOk = true;
                    const json = await resp.json();
                    detail = json.engine || json.status || 'Online';
                }
            }

            const latency = Date.now() - tStart;
            if (isOk) {
                lastCloudWarmTimestamp = Date.now();
                statusBadge.style.background = 'rgba(16, 185, 129, 0.2)';
                statusBadge.style.border = '1px solid #10b981';
                statusBadge.style.color = '#34d399';
                statusBadge.innerText = latency > 3000 ? `🟢 ปลุกเซิร์ฟเวอร์สำเร็จ! (${latency}ms) - ${detail}` : `🟢 เชื่อมต่อสำเร็จ! (${latency}ms) - ${detail}`;
            } else {
                statusBadge.style.background = 'rgba(239, 68, 68, 0.2)';
                statusBadge.style.border = '1px solid #ef4444';
                statusBadge.style.color = '#f87171';
                statusBadge.innerText = `🔴 ไม่สามารถเชื่อมต่อได้ (${latency}ms) - โปรดตรวจสอบเซิร์ฟเวอร์`;
            }
        } catch (err) {
            const latency = Date.now() - tStart;
            statusBadge.style.background = 'rgba(239, 68, 68, 0.2)';
            statusBadge.style.border = '1px solid #ef4444';
            statusBadge.style.color = '#f87171';
            statusBadge.innerText = `🔴 ไม่สามารถเชื่อมต่อได้ (${latency}ms): ${err.message || 'Offline'}`;
        } finally {
            if (coldTimer) clearTimeout(coldTimer);
        }
    });

    // เส้นคั่น
    const quotaDivider = document.createElement('div');
    quotaDivider.style.cssText = `
        width: 100%;
        height: 1px;
        background: rgba(255, 255, 255, 0.12);
        margin: 4px 0;
    `;
    settingsPanel.appendChild(quotaDivider);

    // ส่วนหัวของแดชบอร์ดโควต้า Gemini
    const quotaHeader = document.createElement('div');
    quotaHeader.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
    `;
    
    const quotaTitle = document.createElement('div');
    quotaTitle.style.cssText = `
        font-size: 11px;
        font-weight: 700;
        color: #38bdf8;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        display: flex;
        align-items: center;
        gap: 4px;
    `;
    quotaTitle.innerHTML = `<span>✨</span> โควต้า Gemini API วันนี้`;
    quotaHeader.appendChild(quotaTitle);

    const refreshQuotaBtn = document.createElement('div');
    refreshQuotaBtn.title = 'รีเฟรชสถานะโควต้า';
    refreshQuotaBtn.style.cssText = `
        cursor: pointer;
        color: #94a3b8;
        display: flex;
        align-items: center;
        padding: 2px 4px;
        border-radius: 4px;
        transition: all 0.2s;
        font-size: 11px;
    `;
    refreshQuotaBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.4s;">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
        </svg>
    `;
    refreshQuotaBtn.addEventListener('mouseenter', () => { refreshQuotaBtn.style.color = '#38bdf8'; });
    refreshQuotaBtn.addEventListener('mouseleave', () => { refreshQuotaBtn.style.color = '#94a3b8'; });
    quotaHeader.appendChild(refreshQuotaBtn);
    settingsPanel.appendChild(quotaHeader);

    // ป้ายสรุปโควต้ารวม
    const totalSummaryBadge = document.createElement('div');
    totalSummaryBadge.style.cssText = `
        background: rgba(56, 189, 248, 0.08);
        border: 1px solid rgba(56, 189, 248, 0.2);
        border-radius: 6px;
        padding: 6px 8px;
        font-size: 10px;
        color: #bae6fd;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;
    totalSummaryBadge.innerHTML = `<span>โควต้ารวม 9 รุ่น:</span><strong id="manga-gemini-total-rem">กำลังโหลด...</strong>`;
    settingsPanel.appendChild(totalSummaryBadge);

    // คำอธิบายทำความเข้าใจโควต้า Google (RPD 1,500 vs RPM 15)
    const quotaTip = document.createElement('div');
    quotaTip.style.cssText = `
        font-size: 9.5px;
        color: #94a3b8;
        line-height: 1.35;
        background: rgba(255, 255, 255, 0.03);
        border-radius: 5px;
        padding: 5px 8px;
        border-left: 2px solid #38bdf8;
    `;
    quotaTip.innerHTML = `💡 <b>โควต้าจริง:</b> แต่ละรุ่นมี <b>1,500 หน้า/วัน</b> (รวม 13,500 หน้า)<br>⚡ มีลิมิตความถี่ <b>15 หน้า/นาที (RPM)</b> หากอ่านเร็วติด 15 หน้า ระบบจะพัก 1 นาทีแล้วกลับมาใช้ต่อได้อัตโนมัติ`;
    settingsPanel.appendChild(quotaTip);

    // ปุ่มสลับโหมด Auto Cascade
    const autoCascadeBtn = document.createElement('div');
    autoCascadeBtn.id = 'manga-auto-cascade-btn';
    autoCascadeBtn.style.cssText = `
        background: rgba(99, 102, 241, 0.15);
        border: 1px solid rgba(99, 102, 241, 0.3);
        border-radius: 6px;
        padding: 5px 8px;
        font-size: 10px;
        font-weight: 600;
        color: #a5b4fc;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.2s;
    `;
    autoCascadeBtn.innerHTML = `<span>🔄</span> โหมด Auto Cascade (สลับโมเดลอัตโนมัติเมื่อโควต้าหมด)`;
    autoCascadeBtn.addEventListener('mouseenter', () => { autoCascadeBtn.style.background = 'rgba(99, 102, 241, 0.25)'; });
    autoCascadeBtn.addEventListener('mouseleave', () => { autoCascadeBtn.style.background = 'rgba(99, 102, 241, 0.15)'; });
    autoCascadeBtn.addEventListener('click', () => {
        localStorage.setItem('manga_translation_model', 'gemini');
        if (modelSelect) modelSelect.value = 'gemini';
        console.log('[Manga Translator] Switched to Gemini Auto Cascade');
        fetchAndRenderGeminiQuota();
        resetTranslations();
        if (isTranslationEnabled) startSequentialChapterTranslation();
    });
    settingsPanel.appendChild(autoCascadeBtn);

    // รายการแสดงทั้ง 9 โมเดล
    const quotaListContainer = document.createElement('div');
    quotaListContainer.id = 'manga-gemini-quota-list';
    quotaListContainer.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 250px;
        overflow-y: auto;
        padding-right: 2px;
    `;
    settingsPanel.appendChild(quotaListContainer);

    // ฟังก์ชันดึงและเรนเดอร์ข้อมูลโควต้าสด
    async function fetchAndRenderGeminiQuota() {
        const targetUrl = getActiveServerUrl() + '/gemini_quota';

        const refreshSvg = refreshQuotaBtn.querySelector('svg');
        if (refreshSvg) refreshSvg.style.transform = 'rotate(360deg)';
        setTimeout(() => { if (refreshSvg) refreshSvg.style.transform = 'rotate(0deg)'; }, 400);

        let data = null;
        if (isRealChromeExtension()) {
            try {
                const res = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ action: 'fetch_json', url: targetUrl }, (response) => {
                        if (chrome.runtime && chrome.runtime.lastError || !response || !response.success) resolve(null);
                        else resolve(response.data);
                    });
                });
                if (res) data = res;
            } catch (e) {}
        }
        if (!data && isUserscriptEnvironment()) {
            try {
                const gmRes = await makeGmRequest({
                    method: 'GET',
                    url: targetUrl,
                    headers: { 'Accept': 'application/json' },
                    timeout: 6000
                });
                if (gmRes && gmRes.status >= 200 && gmRes.status < 300 && gmRes.responseText) {
                    try { data = JSON.parse(gmRes.responseText); } catch(err) { data = null; }
                }
            } catch (e) {}
        }
        if (!data) {
            try {
                const controller = new AbortController();
                const tid = setTimeout(() => controller.abort(), 4000);
                const r = await fetch(targetUrl, { signal: controller.signal });
                clearTimeout(tid);
                if (r.ok) data = await r.json();
            } catch (e) {}
        }

        if (!data || !data.models) {
            totalSummaryBadge.innerHTML = `<span style="color:#f87171;">ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์หลังบ้านได้</span>`;
            quotaListContainer.innerHTML = `<div style="font-size:10px; color:#94a3b8; text-align:center; padding:4px;">โปรดตรวจสอบว่ารัน run_backend.bat แล้ว</div>`;
            return;
        }

        const totalRem = data.total_remaining.toLocaleString();
        const totalLim = data.total_limit.toLocaleString();
        totalSummaryBadge.innerHTML = `<span>โควต้ารวม 9 รุ่นคงเหลือ:</span><strong style="color:#38bdf8;">${totalRem} / ${totalLim} หน้า</strong>`;

        const currentActiveSaved = localStorage.getItem('manga_translation_model') || 'google_translate';
        const isAutoActive = (currentActiveSaved === 'gemini');

        if (isAutoActive) {
            autoCascadeBtn.style.background = 'rgba(16, 185, 129, 0.2)';
            autoCascadeBtn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
            autoCascadeBtn.style.color = '#34d399';
            autoCascadeBtn.innerHTML = `<span>✓</span> กำลังใช้งาน: โหมด Auto Cascade (สลับอัตโนมัติ)`;
        } else {
            autoCascadeBtn.style.background = 'rgba(99, 102, 241, 0.15)';
            autoCascadeBtn.style.borderColor = 'rgba(99, 102, 241, 0.3)';
            autoCascadeBtn.style.color = '#a5b4fc';
            autoCascadeBtn.innerHTML = `<span>🔄</span> เปลี่ยนเป็นโหมด Auto Cascade (สลับอัตโนมัติ)`;
        }

        quotaListContainer.innerHTML = '';
        data.models.forEach(m => {
            const item = document.createElement('div');
            const isSpecificSelected = (currentActiveSaved === ('gemini:' + m.id) || currentActiveSaved === m.id);

            item.style.cssText = `
                background: ${isSpecificSelected ? 'rgba(56, 189, 248, 0.1)' : 'rgba(255, 255, 255, 0.04)'};
                border: 1px solid ${isSpecificSelected ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255, 255, 255, 0.08)'};
                border-radius: 6px;
                padding: 6px 8px;
                display: flex;
                flex-direction: column;
                gap: 3px;
                transition: all 0.2s;
            `;

            let badgeHtml = '';
            const isRateLimited = (m.status === 'rate_limited' || (m.status === 'exhausted' && m.used < m.limit));
            const isTrulyExhausted = (m.status === 'exhausted' && m.used >= m.limit);

            if (isTrulyExhausted) {
                badgeHtml = `<span style="font-size:9px; padding:1px 6px; border-radius:10px; background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); font-weight:600;">ครบ 1,500/วันแล้ว</span>`;
            } else if (isRateLimited) {
                const secs = (m.rate_limit_secs && m.rate_limit_secs > 0) ? ` (${m.rate_limit_secs} วิ)` : '';
                badgeHtml = `<span title="ติดลิมิตความถี่ 15 หน้า/นาทีของ Google พัก 1 นาทีแล้วกลับมาใช้ได้ต่อ (โควต้า 1,500 ยังเหลือ)" style="font-size:9px; padding:1px 6px; border-radius:10px; background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.3); font-weight:600; cursor:help;">🟡 ติด RPM พัก 1 นาที${secs}</span>`;
            } else if (m.status === 'ready') {
                badgeHtml = `<span style="font-size:9px; padding:1px 6px; border-radius:10px; background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3); font-weight:600;">🟢 พร้อมใช้</span>`;
            } else {
                badgeHtml = `<span style="font-size:9px; padding:1px 6px; border-radius:10px; background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.3); font-weight:600;">พักชั่วคราว</span>`;
            }

            const pct = Math.min(100, Math.round((m.used / m.limit) * 100));
            const barColor = isTrulyExhausted ? '#ef4444' : (isRateLimited ? '#fbbf24' : (pct > 80 ? '#f59e0b' : '#38bdf8'));
            const speedText = m.avg_speed || '~1s';
            const descText = m.desc || '';

            const selectBtnText = isSpecificSelected 
                ? `<span style="color:#38bdf8; font-weight:700;">✓ กำลังใช้งานรุ่นนี้</span>` 
                : `<span style="color:#94a3b8; cursor:pointer;" title="คลิกเพื่อเลือกเจาะจงใช้รุ่นนี้">👉 เลือกใช้รุ่นนี้</span>`;

            item.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:5px;">
                        <span style="font-size:11px; font-weight:600; color:#f1f5f9;">${m.name}</span>
                        <span style="font-size:9px; padding:0 4px; border-radius:4px; background:rgba(56,189,248,0.15); color:#38bdf8; font-family:monospace;">${speedText}</span>
                    </div>
                    ${badgeHtml}
                </div>
                ${descText ? `<div style="font-size:9.5px; color:#94a3b8; line-height:1.2;">${descText}</div>` : ''}
                <div style="width:100%; height:4px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden; margin:2px 0;">
                    <div style="width:${pct}%; height:100%; background:${barColor}; transition:width 0.4s;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:9.5px;">
                    <span style="color:#64748b;">ใช้ ${m.used.toLocaleString()} / ${m.limit.toLocaleString()} (เหลือ ${m.remaining.toLocaleString()})</span>
                    <div class="manga-select-specific-btn" data-model="gemini:${m.id}" style="font-size:9.5px;">
                        ${selectBtnText}
                    </div>
                </div>
            `;

            // เพิ่ม event คลิกเพื่อเลือกเจาะจงโมเดลนี้
            const pickBtn = item.querySelector('.manga-select-specific-btn');
            if (pickBtn && !isSpecificSelected) {
                item.style.cursor = 'pointer';
                item.addEventListener('click', () => {
                    const targetVal = 'gemini:' + m.id;
                    localStorage.setItem('manga_translation_model', targetVal);
                    if (modelSelect) modelSelect.value = targetVal;
                    console.log('[Manga Translator] Switched specific model to:', targetVal);
                    fetchAndRenderGeminiQuota();
                    resetTranslations();
                    if (isTranslationEnabled) startSequentialChapterTranslation();
                });
            }

            quotaListContainer.appendChild(item);
        });
    }

    refreshQuotaBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fetchAndRenderGeminiQuota();
    });

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
    let quotaPollInterval = null;
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (settingsPanel.style.display === 'none' || settingsPanel.style.display === '') {
            settingsPanel.style.display = 'flex';
            ipInput.focus();
            fetchAndRenderGeminiQuota();
            if (!quotaPollInterval) {
                quotaPollInterval = setInterval(() => {
                    if (settingsPanel && settingsPanel.style.display !== 'none') {
                        fetchAndRenderGeminiQuota();
                    } else if (quotaPollInterval) {
                        clearInterval(quotaPollInterval);
                        quotaPollInterval = null;
                    }
                }, 5000);
            }
        } else {
            settingsPanel.style.display = 'none';
            if (quotaPollInterval) {
                clearInterval(quotaPollInterval);
                quotaPollInterval = null;
            }
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
        updateOverlaysVisibility();
        
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
            const mangaImages = getSortedMangaImages();
            const translatedCount = mangaImages.filter(img => img.dataset.mangaStatus === "translated").length;
            if (translatedCount > 0) {
                textSpan.innerText = `ดูแบบแปล (แปลแล้ว ${translatedCount}/${mangaImages.length} หน้า)`;
            } else {
                textSpan.innerText = 'แปลหน้านี้ (Translate Page)';
            }
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



// ฟังก์ชันแปลง Blob เป็น Base64 Data URL (รองรับ Blob, ArrayBuffer, Uint8Array และ Binary String อย่างปลอดภัย)
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        try {
            if (!blob) return reject(new Error('Empty blob or response'));
            if (typeof blob === 'string') {
                if (blob.startsWith('data:image/')) {
                    return resolve(blob);
                }
                const len = blob.length;
                const u8 = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    u8[i] = blob.charCodeAt(i) & 0xff;
                }
                blob = new Blob([u8], { type: 'image/jpeg' });
            } else if (blob instanceof ArrayBuffer) {
                blob = new Blob([blob], { type: 'image/jpeg' });
            } else if (blob && blob.buffer instanceof ArrayBuffer) {
                blob = new Blob([blob.buffer], { type: 'image/jpeg' });
            } else if (!(blob instanceof Blob)) {
                return reject(new Error('Unsupported blob format'));
            }

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
        } catch (err) {
            reject(err);
        }
    });
}

// ฟังก์ชันแปลง base64 เป็น local blob URL เพื่อความเร็วสูงสุดและป้องกันการวนลูป DOM
function base64ToBlobUrl(base64) {
    try {
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
    } catch (e) {
        console.warn('[Manga Translator] base64ToBlobUrl failed:', e);
        return null;
    }
}

// ฟังก์ชันปรับขนาด/บีบอัด Base64 สำหรับภาพขนาดใหญ่พิเศษ (เช่น Webtoon หรือหน้าสแกน 2K-4K)
// แปลงเป็น JPEG 0.85 และจำกัดความยาวไม่เกิน 1800px เพื่อลด payload เหลือเพียง ~250-450KB
// ช่วยให้ iPad ส่งข้อมูลขึ้น Render ข้ามประเทศได้ไวขึ้น 4-5 เท่า และลดเวลาประมวลผลบนเซิร์ฟเวอร์
async function compressBase64IfNeeded(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        return dataUrl;
    }
    // หากข้อมูลมีขนาดเล็กมาก (< 500KB) และไม่ใช่ PNG ไม่จำเป็นต้องบีบอัดซ้ำ
    if (dataUrl.length < 650000 && !dataUrl.startsWith('data:image/png')) {
        return dataUrl;
    }
    try {
        const tempImg = new Image();
        // ไม่ใส่ crossOrigin กับ data: URL เพื่อป้องกัน Safari WebKit บัคไม่โหลดรูป
        const loaded = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), 4000);
            tempImg.onload = () => { clearTimeout(timer); resolve(true); };
            tempImg.onerror = () => { clearTimeout(timer); resolve(false); };
            tempImg.src = dataUrl;
        });
        if (!loaded || !tempImg.naturalWidth || !tempImg.naturalHeight) {
            return dataUrl;
        }

        let targetW = tempImg.naturalWidth;
        let targetH = tempImg.naturalHeight;
        const maxDim = Math.max(targetW, targetH);
        // หากภาพด้านยาวเกิน 1800px ให้สเกลลงเล็กน้อยเพื่อความเร็วสูงสุด
        if (maxDim > 1800) {
            const scale = 1800.0 / maxDim;
            targetW = Math.round(targetW * scale);
            targetH = Math.round(targetH * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(tempImg, 0, 0, targetW, targetH);
        const jpegUrl = canvas.toDataURL('image/jpeg', 0.85);
        if (jpegUrl && jpegUrl.length > 200 && (jpegUrl.length < dataUrl.length || maxDim > 1800)) {
            console.log(`[Manga Translator] Optimized image payload: ${(dataUrl.length/1024/1024).toFixed(2)}MB -> ${(jpegUrl.length/1024/1024).toFixed(2)}MB`);
            return jpegUrl;
        }
    } catch (e) {
        console.warn('[Manga Translator] Base64 compression skipped:', e);
    }
    return dataUrl;
}

// ฟังก์ชันดึงรูปภาพต้นฉบับอย่างปลอดภัย 100% (รองรับ Blob, CORS Bypass ผ่าน Background Service Worker & Userscript GM)
async function fetchMangaImageAsBase64(url, img) {
    // 0. หากมี base64 เดิมที่แคชไว้แล้ว
    if (img && img.dataset && img.dataset.originalDataUrl) {
        return img.dataset.originalDataUrl;
    }

    const rawData = await _doFetchMangaImageRaw(url, img);
    if (rawData && rawData.startsWith('data:image/')) {
        const optimized = await compressBase64IfNeeded(rawData);
        if (img && img.dataset) {
            img.dataset.originalDataUrl = optimized;
        }
        return optimized;
    }
    return rawData;
}

async function _doFetchMangaImageRaw(url, img) {
    if (!url) return null;

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
    if (isRealChromeExtension()) {
        try {
            const bgRes = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve(null), 25000);
                chrome.runtime.sendMessage({
                    action: 'fetch_image_base64',
                    url: url
                }, (response) => {
                    clearTimeout(timer);
                    if (chrome.runtime && chrome.runtime.lastError) {
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

    // 3. กรณี Tampermonkey / Safari Userscript ให้ดึงผ่าน GM_xmlhttpRequest / GM.xmlHttpRequest ไร้ CORS
    if (isUserscriptEnvironment()) {
        try {
            const gmRes = await makeGmRequest({
                method: 'GET',
                url: url,
                responseType: 'blob',
                timeout: 25000
            });
            if (gmRes && ((gmRes.status >= 200 && gmRes.status < 300) || gmRes.status === 0)) {
                const responseData = gmRes.response || gmRes.responseText;
                if (responseData) {
                    const dataUrl = await blobToDataUrl(responseData);
                    if (dataUrl && dataUrl.startsWith('data:image/')) {
                        return dataUrl;
                    }
                }
            }
        } catch (gmErr) {
            console.warn('[Manga Translator] GM image fetch error:', gmErr);
        }
    }

    // 4. วิธีสำรอง: ลอง Canvas export (กรณีรูปโหลดเสร็จใน DOM แล้วและไม่ติด CORS Taint)
    if (img && img.complete && img.naturalWidth >= 200 && img.naturalHeight >= 200) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const canvasData = canvas.toDataURL('image/jpeg', 0.88);
            if (canvasData && canvasData.startsWith('data:image/')) {
                return canvasData;
            }
        } catch (canvasErr) {}
    }

    // 5. วิธีสำรอง: ลอง fetch ตรง
    try {
        const resp = await fetch(url);
        if (resp.ok) {
            const blob = await resp.blob();
            return await blobToDataUrl(blob);
        }
    } catch (fetchErr) {}

    return null;
}

// ฟังก์ชันกลางสำหรับส่งคำขอแปลภาพ รองรับ Chrome Extension Background, Userscript GM_xhr และ Direct Fetch
async function sendTranslationRequest(cleanServerUrl, requestPayload, requestTimeoutMs) {
    // วิธีที่ 1: ส่งผ่าน Extension Background Service Worker (เลี่ยงปัญหา CSP, CORS 100%)
    if (isRealChromeExtension()) {
        try {
            const bgRes = await new Promise((resolve) => {
                const timer = setTimeout(() => {
                    console.warn(`[Manga Translator] Background sendMessage timeout (${Math.round(requestTimeoutMs/1000)}s)`);
                    resolve(null);
                }, requestTimeoutMs + 3000);

                try {
                    chrome.runtime.sendMessage({
                        action: 'translate_base64',
                        url: `${cleanServerUrl}/translate_base64`,
                        data: requestPayload,
                        timeout: requestTimeoutMs
                    }, (response) => {
                        clearTimeout(timer);
                        if (chrome.runtime && chrome.runtime.lastError) {
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
                return bgRes.data;
            } else {
                console.warn('[Manga Translator] Background translation reported error/timeout:', bgRes ? bgRes.error : 'No response');
            }
        } catch (bgErr) {
            console.warn('[Manga Translator] Background proxy attempt error:', bgErr);
        }
    }

    // วิธีที่ 2: ส่งผ่าน GM_xmlhttpRequest / GM.xmlHttpRequest (สำหรับ Safari Userscripts / Tampermonkey)
    if (isUserscriptEnvironment()) {
        try {
            const gmRes = await makeGmRequest({
                method: 'POST',
                url: `${cleanServerUrl}/translate_base64`,
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                data: JSON.stringify(requestPayload),
                timeout: requestTimeoutMs
            });

            if (gmRes && gmRes.status >= 200 && gmRes.status < 300 && gmRes.responseText) {
                try {
                    return JSON.parse(gmRes.responseText);
                } catch (err) {
                    console.warn('[Manga Translator] Failed to parse GM response JSON:', err);
                }
            } else {
                console.warn('[Manga Translator] GM translate request returned status:', gmRes ? gmRes.status : 'no response');
            }
        } catch (gmErr) {
            console.warn('[Manga Translator] GM_xmlhttpRequest attempt failed:', gmErr);
        }
    }

    // วิธีที่ 3: ส่งผ่าน fetch ตรง (กรณีเข้าถึงเซิร์ฟเวอร์ได้โดยตรง)
    try {
        const controller = new AbortController();
        const fetchTimer = setTimeout(() => controller.abort(), requestTimeoutMs);
        const response = await fetch(`${cleanServerUrl}/translate_base64`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(requestPayload),
            signal: controller.signal
        });
        clearTimeout(fetchTimer);

        if (response.ok) {
            return await response.json();
        } else {
            console.warn(`[Manga Translator] Server responded with status ${response.status}`);
        }
    } catch (fetchErr) {
        console.warn('[Manga Translator] Direct fetch failed:', fetchErr);
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

        const isCloudSource = (localStorage.getItem('manga_backend_source') === 'cloud');
        const requestTimeoutMs = isCloudSource ? 90000 : 35000;

        // Watchdog Safety Timer: ปลดเบลออัตโนมัติหากเกินเวลา ป้องกันหน้าเว็บค้างเบลอถาวรเด็ดขาด (ยืดเวลาสำหรับ Render Cold Start)
        blurSafetyTimer = setTimeout(() => {
            if (img.dataset.mangaStatus !== "translated") {
                img.style.filter = "none";
            }
        }, requestTimeoutMs + 5000);

        const targetUrl = img.dataset.originalSrc || img.currentSrc || img.src;
        if (!img.dataset.originalSrc) {
            img.dataset.originalSrc = targetUrl;
        }

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

        // ดึง URL เซิร์ฟเวอร์ที่เปิดใช้งานอยู่ (รองรับสลับ Local 127.0.0.1 หรือ Cloud บน Render)
        const cleanServerUrl = getActiveServerUrl();

        // ตรวจสอบโมเดลและระบบประมวลผลก่อนส่ง
        const currentModel = localStorage.getItem('manga_translation_model') || 'gemini';
        const currentEngine = localStorage.getItem('manga_engine_mode') || 'vision';
        const requestPayload = { 
            image_base64: base64Data,
            source_lang: localStorage.getItem('manga_source_lang') || 'en',
            translation_model: currentModel,
            engine_mode: currentEngine
        };

        const data = await sendTranslationRequest(cleanServerUrl, requestPayload, requestTimeoutMs);

        // หากผู้ใช้สลับโมเดลหรือระบบประมวลผลระหว่างส่งคำขอ ห้ามนำผลลัพธ์ของโมเดลเก่ามาแปะทับ
        if (localStorage.getItem('manga_translation_model') !== currentModel ||
            localStorage.getItem('manga_engine_mode') !== currentEngine) {
            console.log('[Manga Translator] Ignored obsolete result after model/engine switch');
            img.style.filter = "none";
            return;
        }
        
        if (data && data.image) {
            let finalSrc = data.image; // ใช้ Base64 Data URL เป็นฐานที่ปลอดภัยที่สุด
            try {
                const blobUrl = base64ToBlobUrl(data.image);
                if (blobUrl) finalSrc = blobUrl;
            } catch (blobErr) {
                console.warn('[Manga Translator] Blob URL creation failed, using raw dataUrl:', blobErr);
            }

            img.dataset.translatedSrc = finalSrc;
            img.dataset.translatedDataUrl = data.image;
            img.dataset.mangaStatus = "translated";
            img.style.filter = "none";
            
            // สำรองและถอด srcset เดิมออกเพื่อไม่ให้เบราว์เซอร์บังคับใช้ภาพต้นฉบับ
            if (img.srcset) {
                if (!img.dataset.originalSrcset) img.dataset.originalSrcset = img.srcset;
                img.removeAttribute('srcset');
            }

            // เปลี่ยนรูปในหน้าจอหากผู้ใช้เปิดใช้งานการแปล
            if (isTranslationEnabled) {
                isInternalSrcChange = true;
                img.src = finalSrc;
                // ใน Safari หาก Blob URL ไม่โหลด ให้คืนค่าเป็น Data URL ทันที
                if (finalSrc !== data.image) {
                    img.addEventListener('error', () => {
                        console.warn('[Manga Translator] Blob URL render failed on Safari, falling back to data URL');
                        img.src = data.image;
                    }, { once: true });
                }
                setTimeout(() => { isInternalSrcChange = false; }, 120);
            }
        } else {
            // หากใช้ Cloud และเกิด Timeout หรือ 502/503 จาก Cold Start
            if (isCloudSource) {
                console.warn('[Manga Translator] Cloud backend cold start or temporary failure. Retrying cleanly...');
                warmUpCloudServer(true); // ปลุกเซิร์ฟเวอร์
                img.dataset.mangaStatus = "pending"; // คืนสถานะเพื่อให้ supervisor แปลต่อเมื่อพร้อม
                img.style.filter = "none";
                await new Promise(r => setTimeout(r, 3000));
                return;
            }

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

// 4. ฟังก์ชันควบคุมการแสดงผลตามสถานะเปิด/ปิด (สลับระหว่างต้นฉบับกับแบบแปลทันที)
function updateOverlaysVisibility() {
    isInternalSrcChange = true;
    try {
        const images = document.querySelectorAll('img');
        images.forEach(img => {
            const hasTranslated = (img.dataset.mangaStatus === "translated") || Boolean(img.dataset.translatedSrc) || Boolean(img.dataset.translatedDataUrl);
            if (hasTranslated) {
                if (isTranslationEnabled) {
                    let transSrc = img.dataset.translatedSrc;
                    if (!transSrc && img.dataset.translatedDataUrl) {
                        transSrc = base64ToBlobUrl(img.dataset.translatedDataUrl);
                        img.dataset.translatedSrc = transSrc;
                    }
                    if (transSrc) {
                        if (img.srcset) {
                            if (!img.dataset.originalSrcset) img.dataset.originalSrcset = img.srcset;
                            img.removeAttribute('srcset');
                        }
                        if (img.src !== transSrc) {
                            img.src = transSrc;
                        }
                    }
                    img.style.filter = "none";
                } else {
                    const original = img.dataset.originalBlobUrl || img.dataset.originalDataUrl || img.dataset.originalSrc;
                    if (original && img.src !== original) {
                        img.src = original;
                    }
                    if (img.dataset.originalSrcset && !img.srcset) {
                        img.srcset = img.dataset.originalSrcset;
                    }
                    img.style.filter = "none";
                }
            }
            if (!isTranslationEnabled) {
                img.style.filter = "none";
                if (img.dataset.mangaStatus === "processing") {
                    const original = img.dataset.originalBlobUrl || img.dataset.originalDataUrl || img.dataset.originalSrc;
                    if (original && img.src !== original) {
                        img.src = original;
                    }
                    if (img.dataset.originalSrcset && !img.srcset) {
                        img.srcset = img.dataset.originalSrcset;
                    }
                }
            }
        });
    } catch (err) {
        console.error('[Manga Translator] updateOverlaysVisibility error:', err);
    } finally {
        setTimeout(() => { isInternalSrcChange = false; }, 200);
    }
}

// เริ่มต้นรันระบบเมื่อหน้าเว็บโหลดเสร็จ (สร้างปุ่มลอยควบคุม)
createToggleUI();


