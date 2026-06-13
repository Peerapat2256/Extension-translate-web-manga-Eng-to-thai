document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('model-select');
    
    // โหลดการตั้งค่าเดิมที่บันทึกไว้
    const savedModel = localStorage.getItem('manga_popup_model') || 'gemini';
    select.value = savedModel;
    
    // บันทึกเมื่อมีการเปลี่ยนค่า
    select.addEventListener('change', () => {
        localStorage.setItem('manga_popup_model', select.value);
    });
});

document.getElementById('translate-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
        const selectedModel = document.getElementById('model-select').value;
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: runPureDirectTranslation,
            args: [selectedModel]
        });
        window.close();
    }
});

// ฟังก์ชันแปลจังหวะเดียวจบ โดยไม่แตะต้องหรือแทรกโหนด DOM ใหม่เลยเพื่อความเสถียรสูงสุด (Direct Src-Swapping Method)
function runPureDirectTranslation(selectedModel) {
    const images = document.querySelectorAll('img');
    
    images.forEach(async (img, index) => {
        // คัดกรองเฉพาะหน้ามังงะหลักแผ่นใหญ่
        const width = img.naturalWidth || img.offsetWidth;
        if (img.src && width > 250) {
            
            // ป้องกันรูป base64 ของตัวระบบเอง
            if (img.src.startsWith('data:image/jpeg;base64,')) return;
 
            // ตรวจจับรูปภาพถูกรีไซเคิล DOM (ผู้ใช้เลื่อนหน้ามังงะเปลี่ยนรูป แต่ใช้แท็ก img เดิม)
            if (img.dataset.originalSrc && 
                img.src !== img.dataset.originalSrc && 
                img.src !== img.dataset.translatedSrc) {
                
                // ล้างสถานะเก่าเพื่อให้รูปภาพหน้าใหม่ถูกส่งไปแปลใหม่
                delete img.dataset.mangaStatus;
                delete img.dataset.originalSrc;
                delete img.dataset.translatedSrc;
            }
 
            // หากเคยแปลแล้วแต่โดน React/Vue รีเซ็ตค่ากลับ ให้ใส่ค่าที่แปลแล้วทันที
            if (img.dataset.mangaStatus === "translated") {
                if (img.dataset.translatedSrc && img.src !== img.dataset.translatedSrc) {
                    img.src = img.dataset.translatedSrc;
                }
                return;
            }
 
            if (img.dataset.mangaStatus === "processing") return;
            
            img.dataset.mangaStatus = "processing";
            img.dataset.originalSrc = img.src;
 
            // สร้าง Canvas จำลองขนาดตามเนื้อไฟล์ภาพจริงเพื่อส่งไปแปล
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            
            if (w === 0 || h === 0) {
                img.dataset.mangaStatus = "error";
                return;
            }
            canvas.width = w;
            canvas.height = h;
 
            try {
                // วาดภาพลง Canvas และแปลงเป็น Base64
                ctx.drawImage(img, 0, 0, w, h);
                const base64Data = canvas.toDataURL('image/jpeg', 0.80);
 
                // ดึง URL ที่ผู้ใช้ตั้งค่าไว้ (รองรับการรันจากมือถือชี้มาที่ IP คอมพิวเตอร์หลัก)
                let serverUrl = localStorage.getItem('manga_api_url') || 'http://127.0.0.1:8000';
                serverUrl = serverUrl.trim();
                if (!/^https?:\/\//i.test(serverUrl)) {
                    serverUrl = 'http://' + serverUrl;
                }
                const cleanServerUrl = serverUrl.replace(/\/$/, '');

                // ส่งไปหา Python หลังบ้าน
                const response = await fetch(`${cleanServerUrl}/translate_base64`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        image_base64: base64Data,
                        source_lang: localStorage.getItem('manga_source_lang') || 'en',
                        translation_model: selectedModel || 'gemini'
                    })
                });
 
                const data = await response.json();
                if (data.image) {
                    img.dataset.translatedSrc = data.image;
                    img.dataset.mangaStatus = "translated";
                    img.src = data.image;
                } else {
                    img.dataset.mangaStatus = "error";
                }
            } catch (e) {
                console.error("Error during single image translation:", e);
                img.dataset.mangaStatus = "error";
            }
        }
    });
}