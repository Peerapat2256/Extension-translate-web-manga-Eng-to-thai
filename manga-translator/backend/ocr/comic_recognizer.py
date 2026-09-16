import easyocr
import numpy as np
from core.config import CUDA_AVAILABLE
from vision.deskew_normalizer import enhance_contrast_clahe, estimate_rotation_angle, deskew_crop
from PIL import Image

_reader_en = None
_reader_ko = None

def get_reader(lang="en"):
    global _reader_en, _reader_ko
    if lang == "ko":
        if _reader_ko is None:
            print(f"[OCR] Initializing Korean Manga OCR (CUDA={CUDA_AVAILABLE})...")
            _reader_ko = easyocr.Reader(['ko', 'en'], gpu=CUDA_AVAILABLE)
        return _reader_ko
    else:
        if _reader_en is None:
            print(f"[OCR] Initializing English Manga OCR (CUDA={CUDA_AVAILABLE})...")
            _reader_en = easyocr.Reader(['en'], gpu=CUDA_AVAILABLE)
        return _reader_en

import math

def _nms_boxes(boxes, iou_thresh=0.55):
    """Deduplicates overlapping bounding boxes from chunk edges, keeping highest confidence."""
    if not boxes:
        return []
    boxes = sorted(boxes, key=lambda b: b.get("conf", 1.0), reverse=True)
    kept = []
    for b in boxes:
        x1, y1, x2, y2 = b["x_min"], b["y_min"], b["x_max"], b["y_max"]
        area = max(1, (x2 - x1) * (y2 - y1))
        is_dup = False
        for k in kept:
            kx1, ky1, kx2, ky2 = k["x_min"], k["y_min"], k["x_max"], k["y_max"]
            karea = max(1, (kx2 - kx1) * (ky2 - ky1))
            ix1, iy1 = max(x1, kx1), max(y1, ky1)
            ix2, iy2 = min(x2, kx2), min(y2, ky2)
            iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
            inter = iw * ih
            if inter > 0 and (inter / min(area, karea)) > iou_thresh:
                is_dup = True
                break
        if not is_dup:
            kept.append(b)
    kept.sort(key=lambda b: (b["y_min"], b["x_min"]))
    return kept

def _run_offline_manga_ocr_single(img_pil, lang="en"):
    """Runs OCR on a single standard image or tile crop without downscale penalty."""
    img_np = np.array(img_pil)
    h_img, w_img = img_np.shape[:2]
    reader = get_reader(lang)
    
    # High-Performance GPU Batch Pass with canvas size matched to tile
    results1 = reader.readtext(img_np, canvas_size=2200, batch_size=16)
    
    def parse_box_entry(pts, text, conf, is_inverted=False):
        pts = np.array(pts)
        x_min = max(0, int(np.min(pts[:, 0])))
        y_min = max(0, int(np.min(pts[:, 1])))
        x_max = min(w_img, int(np.max(pts[:, 0])))
        y_max = min(h_img, int(np.max(pts[:, 1])))
        
        angle = 0.0
        if len(pts) >= 2:
            dx = pts[1][0] - pts[0][0]
            dy = pts[1][1] - pts[0][1]
            if dx != 0:
                angle = math.degrees(math.atan2(dy, dx))
                
        crop = img_np[y_min:y_max, x_min:x_max]
        mean_brightness = float(np.mean(crop)) if crop.size > 0 else 128.0
        
        return {
            "x_min": x_min,
            "y_min": y_min,
            "x_max": x_max,
            "y_max": y_max,
            "pts": pts.tolist(),
            "text": text,
            "conf": conf,
            "angle": angle,
            "brightness": mean_brightness,
            "inverted": is_inverted
        }

    boxes = [parse_box_entry(p, t, c, False) for p, t, c in results1]
    
    # Targeted Inverted Recovery for dark backgrounds
    for b in boxes:
        if b["brightness"] < 95 and b["conf"] < 0.45:
            crop = img_np[b["y_min"]:b["y_max"], b["x_min"]:b["x_max"]]
            if crop.size > 0:
                inv_crop = 255 - crop
                crop_res = reader.readtext(inv_crop)
                if crop_res and crop_res[0][2] > b["conf"]:
                    b["text"] = crop_res[0][1]
                    b["conf"] = crop_res[0][2]
                    b["inverted"] = True
                    
    return boxes

def run_offline_manga_ocr(img_pil, lang="en"):
    """
    World-Class Offline Manga OCR Pipeline:
    1. Automatic tall webtoon strip detection & tiled processing (zero resolution loss)
    2. Direct 4-point polygon angle detection
    3. Adaptive threshold detection for comic lettering
    4. Seamless NMS deduplication across tile seams
    """
    w_img, h_img = img_pil.size
    
    # If image is a tall webtoon strip (h > 2400 and h/w > 1.8), process in native-resolution tiles!
    if h_img > 2400 and (h_img / max(1, w_img)) > 1.8:
        chunk_h = 2200
        overlap = 300
        step = chunk_h - overlap
        all_boxes = []
        y_start = 0
        while y_start < h_img:
            y_end = min(h_img, y_start + chunk_h)
            crop = img_pil.crop((0, y_start, w_img, y_end))
            chunk_boxes = _run_offline_manga_ocr_single(crop, lang=lang)
            for b in chunk_boxes:
                b["y_min"] += y_start
                b["y_max"] += y_start
                if "pts" in b:
                    for pt in b["pts"]:
                        pt[1] += y_start
                all_boxes.append(b)
            if y_end >= h_img:
                break
            y_start += step
        return _nms_boxes(all_boxes)
        
    return _run_offline_manga_ocr_single(img_pil, lang=lang)

