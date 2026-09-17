import time
import re
import cv2
import numpy as np
from PIL import Image
from ocr.comic_recognizer import run_offline_manga_ocr
from ocr.spell_corrector import clean_ocr_text, is_valid_english_dialogue, is_watermark_or_noise
from vision.bubble_detector import cluster_lines_into_bubbles
from vision.comic_detector import detect_comic_text_and_mask
from vision.style_extractor import extract_style_from_crop
from inpainting.dual_cleaner import inpaint_manga_page
from typesetter.graphic_renderer import render_manga_text
from typesetter.thai_formatter import clean_manga_text
from translator.gemini_engine import translate_batch_gemini, translate_manga_vision
from translator.google_engine import translate_texts_google
from translator.ollama_engine import translate_batch_ollama, unload_ollama_models

VALID_SINGLE_WORDS = {"i", "a", "o", "u"}

def is_noise_box(text, box_w, box_h, conf):
    """Filter out single letters or UI overlays (e.g. Translate Page, Tampermonkey)"""
    if re.search(r'translate\s*page|แปลหน้า|tampermonkey|translate\b|google\s*translate|ulaiinu|uaulnv|ulainu|uau', text, re.IGNORECASE):
        return True
    cleaned = re.sub(r'[^a-zA-Z0-9]', '', text).strip()
    if not cleaned:
        return True
    # Discard standalone single digits or noise (e.g. '0', '1') with low conf
    if cleaned.isdigit() and len(cleaned) <= 2 and conf < 0.8:
        return True
    if len(cleaned) == 1 and cleaned.lower() not in VALID_SINGLE_WORDS:
        return True
    if (box_w < 18 or box_h < 14) and conf < 0.35:
        return True
    return False

def process_manga_image(img_pil, source_lang="en", target_lang="th", translator="gemini"):
    """
    World-Class Manga Pipeline Coordinator:
    1. Deep Learning Comic-Text-Detector (Exact text segmentation & inpaint mask)
    2. High-Performance Offline Manga OCR (0.4s GPU batch, auto-angle & contrast boost)
    3. Hierarchical Bubble Clustering (Sentence Assembly per Bubble)
    4. One-Pass Precision Polygon Stroke Inpainting (Zero floating boxes, 100% art preservation)
    5. High-Throughput Batch Translation (Gemini Singleton + Parallel Google Fallback)
    6. Shape-Aware Dynamic Typesetting
    """
    t0 = time.time()
    if img_pil.mode != "RGB":
        img_pil = img_pil.convert("RGB")
    w_img, h_img = img_pil.size
    img_np = np.array(img_pil)
    img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)

    # 1. High-Precision Gemini Multimodal Vision Pipeline (Single-pass OCR + Dialogue Translation)
    is_gemini_mode = (not translator or translator == "gemini" or str(translator).startswith("gemini"))
    if is_gemini_mode:
        preferred_model = None
        tr_str = str(translator).strip()
        if tr_str.startswith("gemini:"):
            preferred_model = tr_str.split(":", 1)[1].strip()
        elif tr_str.startswith("gemini-"):
            preferred_model = tr_str

        t_v0 = time.time()
        vision_items = translate_manga_vision(
            img_pil,
            preferred_model=preferred_model,
            source_lang=source_lang,
            target_lang=target_lang
        )
        t_v1 = time.time()

        if vision_items and isinstance(vision_items, list) and len(vision_items) > 0:
            print(f"[Pipeline] Gemini Vision detected & translated {len(vision_items)} dialogues in {t_v1-t_v0:.2f}s!")
            dl_mask, dl_boxes = detect_comic_text_and_mask(img_bgr)
            
            active_bubbles_to_render = []
            metadata = []
            
            for item in vision_items:
                box = item.get("box_2d", [0, 0, 0, 0])
                y1 = int(box[0] * h_img / 1000.0)
                x1 = int(box[1] * w_img / 1000.0)
                y2 = int(box[2] * h_img / 1000.0)
                x2 = int(box[3] * w_img / 1000.0)
                
                if x2 <= x1 or y2 <= y1:
                    continue
                    
                th_text = clean_manga_text(item.get("th", ""), item.get("en", ""))
                if not th_text or not th_text.strip():
                    continue
                    
                bg_col, text_col, stroke_col, stroke_w = extract_style_from_crop(img_np, x1, y1, x2, y2)
                
                bub = {
                    "x_min": x1, "y_min": y1, "x_max": x2, "y_max": y2,
                    "text": item.get("en", ""),
                    "text_th": th_text,
                    "bg_color": bg_col,
                    "text_color": text_col,
                    "stroke_color": stroke_col,
                    "stroke_width": stroke_w,
                    "angle": 0.0
                }
                active_bubbles_to_render.append(bub)
                metadata.append({
                    "box": [y1, x1, y2, x2],
                    "text_en": item.get("en", ""),
                    "text_th": th_text,
                    "color": "#{:02x}{:02x}{:02x}".format(*text_col[:3]),
                    "angle": 0.0
                })
                
            if active_bubbles_to_render:
                result_pil = inpaint_manga_page(img_bgr, dl_mask, active_bubbles_to_render, active_bubbles_to_render, dl_boxes)
                for bub in active_bubbles_to_render:
                    render_manga_text(
                        result_pil,
                        bub["x_min"], bub["y_min"], bub["x_max"], bub["y_max"],
                        bub["text_th"],
                        bub["text_color"],
                        bub["stroke_color"],
                        bub["stroke_width"],
                        bub["angle"]
                    )
                print(f"[Metrics] Gemini Vision Full Pipeline Total: {time.time()-t0:.2f}s")
                return result_pil, metadata
        else:
            print("[Pipeline] Gemini Vision returned empty or fallback triggered. Switching to offline OCR pipeline...")
    
    # 2. Deep learning segmentation mask for offline inpainting fallback
    dl_mask, dl_boxes = detect_comic_text_and_mask(img_bgr)
    t_detect = time.time()
    
    # 2. Offline OCR
    raw_ocr_boxes = run_offline_manga_ocr(img_pil, lang=source_lang)
    t_ocr = time.time()
    
    if not raw_ocr_boxes:
        return img_pil, []
        
    # 3. Filter noise boxes & extract styles
    valid_line_boxes = []
    for box in raw_ocr_boxes:
        clean_text = clean_ocr_text(box["text"])
        box_w = box["x_max"] - box["x_min"]
        box_h = box["y_max"] - box["y_min"]
        conf = box.get("conf", 1.0)
        
        if is_noise_box(clean_text, box_w, box_h, conf) or is_watermark_or_noise(clean_text, conf):
            continue
            
        bg_col, text_col, stroke_col, stroke_w = extract_style_from_crop(
            img_np, box["x_min"], box["y_min"], box["x_max"], box["y_max"]
        )
            
        valid_line_boxes.append({
            "x_min": box["x_min"],
            "y_min": box["y_min"],
            "x_max": box["x_max"],
            "y_max": box["y_max"],
            "pts": box.get("pts"),
            "text": clean_text,
            "angle": box.get("angle", 0.0),
            "conf": box.get("conf", 1.0),
            "color": text_col[:3],
            "text_color": text_col,
            "stroke_color": stroke_col,
            "stroke_width": stroke_w
        })
        
    if not valid_line_boxes:
        return img_pil, []
        
    # 4. Hierarchical Bubble Clustering (merge lines into complete speech bubble sentences)
    bubble_entities = cluster_lines_into_bubbles(valid_line_boxes)
    if not bubble_entities:
        return img_pil, []
        
    # Filter any residual watermark clusters
    bubble_entities = [b for b in bubble_entities if not is_watermark_or_noise(b.get("text", ""), b.get("conf", 1.0))]
    if not bubble_entities:
        return img_pil, []
        
    # 5. Extract styles & prepare translation
    texts_to_translate = []
    for bub in bubble_entities:
        bg_col, text_col, stroke_col, stroke_w = extract_style_from_crop(
            img_np, bub["x_min"], bub["y_min"], bub["x_max"], bub["y_max"]
        )
        bub["bg_color"] = bg_col
        bub["text_color"] = text_col
        bub["stroke_color"] = stroke_col
        bub["stroke_width"] = stroke_w
        texts_to_translate.append(bub["text"])
        
    # 6. Translation (Dedicated Model Routing: Local Ollama vs Google vs Gemini)
    translated = None
    print(f"[*] Translating {len(texts_to_translate)} dialogues with engine: [{translator}]")
    if translator in ["local_gemma2", "local", "ollama", "gemma2", "gemma2:9b"]:
        translated = translate_batch_ollama(texts_to_translate, source_lang, target_lang, model_name="gemma2:9b")
    elif translator in ["local_qwen3", "qwen3", "qwen3:8b"]:
        translated = translate_batch_ollama(texts_to_translate, source_lang, target_lang, model_name="qwen3:8b")
    elif translator in ["local_qwen25", "qwen2.5", "qwen2.5:3b"]:
        translated = translate_batch_ollama(texts_to_translate, source_lang, target_lang, model_name="qwen2.5:3b")
    elif translator in ["google", "google_translate"]:
        unload_ollama_models()
        translated = translate_texts_google(texts_to_translate, source_lang, target_lang)
    else:
        # Gemini (Auto Cascade or Specific Model) with auto fallback to Google Translate
        unload_ollama_models()
        preferred_model = None
        if translator:
            tr_str = str(translator).strip()
            if tr_str.startswith("gemini:"):
                preferred_model = tr_str.split(":", 1)[1].strip()
            elif tr_str.startswith("gemini-"):
                preferred_model = tr_str
            elif tr_str != "gemini":
                preferred_model = None

        translated = translate_batch_gemini(
            texts_to_translate, 
            source_lang, 
            target_lang, 
            preferred_model=preferred_model
        )
        if not translated or all(t == orig for t, orig in zip(translated, texts_to_translate)):
            translated = translate_texts_google(texts_to_translate, source_lang, target_lang)
    t_trans = time.time()
    
    # 7. Collect only bubbles that successfully translated to Thai
    metadata = []
    active_bubbles_to_render = []
    active_boxes_for_inpaint = []
    
    for idx, bub in enumerate(bubble_entities):
        th_text = translated[idx] if (translated and idx < len(translated)) else bub["text"]
        th_text = clean_manga_text(th_text, bub.get("text", ""))
        
        # Double Safeguard: Ensure translated text actually contains target Thai characters
        if target_lang == "th" and not re.search(r'[\u0e00-\u0e7f]', th_text):
            try:
                fb = translate_texts_google([bub["text"]], source_lang, target_lang)
                if fb and fb[0] and re.search(r'[\u0e00-\u0e7f]', fb[0]):
                    th_text = clean_manga_text(fb[0], bub.get("text", ""))
            except Exception:
                pass
                
        # If still no Thai characters when target is Thai, reject watermark/non-translatable text
        if target_lang == "th" and not re.search(r'[\u0e00-\u0e7f]', th_text):
            continue
            
        bub["text_th"] = th_text
        
        # Render all valid translated dialogues
        if not th_text or not th_text.strip():
            continue
            
        metadata.append({
            "box": [bub["y_min"], bub["x_min"], bub["y_max"], bub["x_max"]],
            "text_en": bub["text"],
            "text_th": th_text,
            "color": "#{:02x}{:02x}{:02x}".format(*bub["text_color"]),
            "angle": bub["angle"]
        })
        active_bubbles_to_render.append(bub)
        if "lines" in bub and bub["lines"]:
            active_boxes_for_inpaint.extend(bub["lines"])
        else:
            active_boxes_for_inpaint.append(bub)

    if not active_bubbles_to_render:
        print("[Pipeline] No active dialogue to render on this page. Returning original.")
        return img_pil, []

    # 8. World-Class Precision Stroke Inpainting ONLY for actively translated bubbles!
    # Erases all text inside active speech bubbles while strictly protecting artwork & foreign SFX
    result_pil = inpaint_manga_page(img_bgr, dl_mask, active_boxes_for_inpaint, active_bubbles_to_render, dl_boxes)
    t_inpaint = time.time()
    
    # 9. Typeset (Render Thai text into each active bubble entity)
    for bub in active_bubbles_to_render:
        render_manga_text(
            result_pil,
            bub["x_min"], bub["y_min"], bub["x_max"], bub["y_max"],
            bub["text_th"],
            bub["text_color"],
            bub["stroke_color"],
            bub["stroke_width"],
            bub["angle"]
        )
    t_render = time.time()
    
    print(f"[Metrics] DL-Detect: {t_detect-t0:.2f}s | OCR: {t_ocr-t_detect:.2f}s | Trans: {t_trans-t_ocr:.2f}s | Inpaint: {t_inpaint-t_trans:.2f}s | Typeset: {t_render-t_inpaint:.2f}s | Total: {t_render-t0:.2f}s")
    return result_pil, metadata
