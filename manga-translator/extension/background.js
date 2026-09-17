// Background Service Worker for Manga Universal Translator (Manifest V3)
// Safely proxies translation requests & cross-origin images to bypass page CSP, CORS, Mixed Content, and Private Network restrictions

function arrayBufferToDataUrl(buffer, mimeType) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000; // 32KB chunks to avoid stack overflow
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return `data:${mimeType || 'image/jpeg'};base64,${btoa(binary)}`;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 1. Proxy translation API requests (รองรับ Render Cold Start สูงสุด 90 วินาที)
    if (request.action === 'translate_base64') {
        const timeoutMs = request.timeout || 90000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        fetch(request.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.data),
            signal: controller.signal
        })
        .then(async (response) => {
            clearTimeout(timeoutId);
            if (!response.ok) {
                sendResponse({ 
                    success: false, 
                    status: response.status, 
                    error: `Server responded with status ${response.status}` 
                });
                return;
            }
            const data = await response.json();
            sendResponse({ success: true, data: data });
        })
        .catch((err) => {
            clearTimeout(timeoutId);
            sendResponse({ 
                success: false, 
                error: err.name === 'AbortError' ? `Translation request timed out (${Math.round(timeoutMs/1000)}s - Render Cold Start)` : (err.message || 'Background network request failed') 
            });
        });

        return true; // Keep message channel open for asynchronous sendResponse
    }

    // 2. Proxy cross-origin manga image downloads (bypasses CORS & Canvas Tainting on MangaDex, Webtoons, etc.)
    if (request.action === 'fetch_image_base64') {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);

        fetch(request.url, {
            method: 'GET',
            signal: controller.signal
        })
        .then(async (response) => {
            clearTimeout(timeoutId);
            if (!response.ok) {
                sendResponse({ 
                    success: false, 
                    error: `HTTP ${response.status} fetching image` 
                });
                return;
            }
            const mimeType = response.headers.get('content-type') || 'image/jpeg';
            const buffer = await response.arrayBuffer();
            const dataUrl = arrayBufferToDataUrl(buffer, mimeType);
            sendResponse({ success: true, data: dataUrl });
        })
        .catch((err) => {
            clearTimeout(timeoutId);
            sendResponse({ 
                success: false, 
                error: err.message || 'Background image fetch failed' 
            });
        });

        return true; // Keep message channel open for asynchronous sendResponse
    }

    // 3. Proxy JSON GET requests (สำหรับ /health, /ping, /gemini_quota รองรับการปลุก Cold Start 65s)
    if (request.action === 'fetch_json') {
        const timeoutMs = request.timeout || 65000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        fetch(request.url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            signal: controller.signal
        })
        .then(async (response) => {
            clearTimeout(timeoutId);
            if (!response.ok) {
                sendResponse({ 
                    success: false, 
                    status: response.status, 
                    error: `HTTP ${response.status}` 
                });
                return;
            }
            const data = await response.json();
            sendResponse({ success: true, data: data });
        })
        .catch((err) => {
            clearTimeout(timeoutId);
            sendResponse({ 
                success: false, 
                error: err.name === 'AbortError' ? `Request timed out (${Math.round(timeoutMs/1000)}s - Render Cold Start)` : (err.message || 'Background JSON fetch failed') 
            });
        });

        return true;
    }
});
