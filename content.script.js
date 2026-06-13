// เก็บสถานะเปิด/ปิด
let isTranslationEnabled = true;

// 1. ฟังก์ชันสร้าง Toggle UI ลอยบนหน้าจอ
function createToggleUI() {
    if (document.getElementById('manga-translator-ui')) return;

    const container = document.createElement('div');
    container.id = 'manga-translator-ui';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;background:rgba(0,0,0,0.9);color:#fff;padding:12px 18px;border-radius:8px;font-family:Arial,sans-serif;box-shadow:0 4px 15px rgba(0,0,0,0.5);display:flex;align-items:center;gap:10px;';

    const label = document.createElement('span');
    label.innerText = 'แปลไทย (Overlay)';
    label.style.cssText = 'font-size:14px;font-weight:bold;';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.style.cssText = 'cursor:pointer;width:18px;height:18px;';

    checkbox.addEventListener('change', (e) => {
        isTranslationEnabled = e.target.checked;
        updateOverlaysVisibility();
    });

    container.appendChild(label);
    container.appendChild(checkbox);
    document.body.appendChild(container);
}

// 2. ฟังก์ชันหลักสำหรับจัดการรูปภาพ
function processImages() {
    const images = document.querySelectorAll('img');

    images.forEach(img => {
        if (img.src) {
            // 1. ตรวจสอบพาธรูปภาพ (รองรับทั้ง *.mangadex.org, *.mangadex.network และ blob)
            const isMangaDex = img.src.includes('mangadex.org') || 
                               img.src.includes('mangadex.network') || 
                               img.src.includes('blob:');
            if (!isMangaDex) return;

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
            if (img.dataset.mangaStatus === "translated" && isTranslationEnabled) {
                img.style.filter = "none";
                if (img.src !== img.dataset.translatedSrc) {
                    img.src = img.dataset.translatedSrc;
                }
                return;
            }

            // ถ้าเป็นรูปใหม่ที่ยังไม่ได้ประมวลผล
            if (!img.dataset.mangaStatus) {
                img.dataset.mangaStatus = "init";
                img.dataset.originalSrc = img.src;

                // เมื่อรูปภาพโหลดเสร็จ ให้ตรวจสอบขนาดและเริ่มกระบวนการแปล
                const handleLoad = () => {
                    // กรองเฉพาะภาพขนาดใหญ่ (หน้ามังงะจริง ไม่ใช่ไอคอนหรือโลโก้)
                    // เช็ค naturalWidth ตอนที่รูปโหลดเสร็จจะแม่นยำ 100% แม้รูปจะขยายตัวช้า (Lazy Load)
                    const width = img.naturalWidth || img.offsetWidth;
                    if (width < 250) {
                        img.dataset.mangaStatus = "ignored";
                        return;
                    }

                    if (img.dataset.mangaStatus === "processing") return;
                    img.dataset.mangaStatus = "processing";
                    
                    // ใส่ฟิลเตอร์เบลอและเอฟเฟกต์สีเทาระหว่างที่ส่งระบบแปลข้างหลัง (ความรู้สึกไหลลื่นระดับพรีเมียม)
                    img.style.transition = "filter 0.4s ease-in-out";
                    img.style.filter = "blur(8px) grayscale(20%)";
                    
                    startSingleImageTranslation(img);
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

// 3. ฟังก์ชันแปลรูปภาพเดียวและบันทึกผลลงแอตทริบิวต์
async function startSingleImageTranslation(img) {
    try {
        let base64Data;
        try {
            // ใช้เทคนิคดึงไฟล์ตรง (CORS-safe & Blob-safe) ป้องกันบัก Canvas Tainted ของ Chrome บน mangadex.network
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

        // ส่งข้อมูลไป Python Backend
        const response = await fetch('http://127.0.0.1:8000/translate_base64', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_base64: base64Data })
        });
        
        const data = await response.json();
        
        if (data.image) {
            img.dataset.translatedSrc = data.image;
            img.dataset.mangaStatus = "translated";
            img.style.filter = "none"; // เอาเอฟเฟกต์เบลอออกเมื่อแปลผลเรียบร้อย
            
            // เปลี่ยนรูปในหน้าจอหากผู้ใช้เปิดใช้งานการแปล
            if (isTranslationEnabled) {
                img.src = data.image;
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

// เริ่มต้นรันระบบเมื่อหน้าเว็บโหลดเสร็จ
createToggleUI();
processImages();

// ดักจับการเปลี่ยนแปลงเพื่อแปลรูปภาพใหม่โดยไม่กวนโครงสร้าง DOM เดิม
const observer = new MutationObserver(() => processImages());
observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });