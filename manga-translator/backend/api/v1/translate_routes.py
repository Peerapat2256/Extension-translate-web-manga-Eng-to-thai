import io
import base64
import hashlib
import re
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from PIL import Image
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception:
    pass

from core.cache_manager import image_cache
from pipeline.coordinator import process_manga_image

router = APIRouter()

class MangaRequest(BaseModel):
    image_base64: str
    source_lang: str = "en"
    translation_model: str = "gemini"

@router.post("/translate_base64")
def translate_base64_endpoint(data: MangaRequest):
    try:
        # 1. Quick validation of payload
        raw_input = (data.image_base64 or "").strip()
        if len(raw_input) < 100:
            raise HTTPException(status_code=400, detail="Image payload is empty or too short")

        # Cache check (Model & Lang aware cache key)
        cache_key = hashlib.md5(f"{data.translation_model}_{data.source_lang}_{raw_input}".encode('utf-8')).hexdigest()
        if cache_key in image_cache:
            return image_cache[cache_key]
            
        # Decode base64
        encoded = raw_input
        if encoded.startswith('"') and encoded.endswith('"'):
            encoded = encoded[1:-1]
            
        header = ""
        if "," in encoded:
            header, encoded = encoded.split(",", 1)
            header_lower = header.lower()
            if "text/" in header_lower or "svg" in header_lower or "application/" in header_lower:
                raise HTTPException(status_code=400, detail=f"Unsupported non-image MIME type: {header}")

        encoded = encoded.replace(" ", "+")
        encoded = re.sub(r'[\s\n\r]+', '', encoded)
        missing_padding = len(encoded) % 4
        if missing_padding:
            encoded += '=' * (4 - missing_padding)
            
        try:
            image_bytes = base64.b64decode(encoded)
        except Exception:
            try:
                image_bytes = base64.urlsafe_b64decode(encoded)
            except Exception as b64_err:
                raise HTTPException(status_code=400, detail=f"Malformed base64 string: {b64_err}")
            
        if len(image_bytes) < 100:
            raise HTTPException(status_code=400, detail="Decoded image payload is too small")

        try:
            img = Image.open(io.BytesIO(image_bytes))
            img.load()
            img = img.convert("RGB")
        except Exception as img_err:
            print(f"[API] Ignored unidentifiable image payload ({len(image_bytes)} bytes): {img_err}")
            raise HTTPException(status_code=400, detail=f"Cannot identify image: {img_err}")

        # Filter out icons, spinners, tiny placeholders, and banner ads
        if img.width < 250 or img.height < 250:
            print(f"[API] Skipping small non-manga image: {img.width}x{img.height}")
            return {
                "image": data.image_base64,
                "metadata": {"skipped": f"Image dimensions {img.width}x{img.height} too small for manga page"}
            }
        
        if (img.width / img.height > 2.8) or (img.height / img.width > 25.0):
            print(f"[API] Skipping non-manga banner aspect ratio: {img.width}x{img.height}")
            return {
                "image": data.image_base64,
                "metadata": {"skipped": f"Image aspect ratio {img.width}x{img.height} is banner, not manga page"}
            }
        
        # Process through World-Class Manga Pipeline
        result_img, metadata = process_manga_image(
            img, 
            source_lang=data.source_lang, 
            translator=data.translation_model
        )
        
        # Encode result
        buf = io.BytesIO()
        result_img.save(buf, format="JPEG", quality=95)
        out_b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")
        
        res_payload = {
            "image": out_b64,
            "metadata": metadata
        }
        image_cache[cache_key] = res_payload
        return res_payload
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
def health():
    import torch
    return {
        "status": "online",
        "engine": "World-Class Offline Manga Engine",
        "cuda": torch.cuda.is_available(),
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    }

@router.get("/gemini_quota")
def get_gemini_quota_endpoint():
    from core.quota_tracker import quota_tracker
    return quota_tracker.get_status()
