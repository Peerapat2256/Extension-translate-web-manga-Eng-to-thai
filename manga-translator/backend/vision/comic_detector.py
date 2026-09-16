import os
import cv2
import numpy as np

# Automatically register torch CUDA DLLs if available on Windows
try:
    import torch
    torch_lib = os.path.join(os.path.dirname(torch.__file__), "lib")
    if os.path.exists(torch_lib):
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(torch_lib)
        os.environ["PATH"] = torch_lib + os.pathsep + os.environ.get("PATH", "")
except Exception:
    pass

try:
    import onnxruntime as ort
    HAS_ORT = True
except ImportError:
    HAS_ORT = False

MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "comic-text-detector.onnx")

_session = None

def ensure_model_exists():
    if not os.path.exists(MODEL_PATH):
        try:
            print("[ComicDetector] ONNX model not found locally. Downloading from HuggingFace (mayocream/comic-text-detector-onnx)...")
            from huggingface_hub import hf_hub_download
            import shutil
            downloaded = hf_hub_download(repo_id="mayocream/comic-text-detector-onnx", filename="comic-text-detector.onnx")
            os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
            shutil.copyfile(downloaded, MODEL_PATH)
            print("[ComicDetector] ONNX model successfully downloaded and ready!")
        except Exception as dl_err:
            print("[ComicDetector] Could not auto-download model:", dl_err)

def get_detector_session():
    global _session
    if _session is None and HAS_ORT:
        ensure_model_exists()
        if os.path.exists(MODEL_PATH):
            try:
                available_providers = ort.get_available_providers()
                providers = ['CUDAExecutionProvider', 'CPUExecutionProvider'] if 'CUDAExecutionProvider' in available_providers else ['CPUExecutionProvider']
                _session = ort.InferenceSession(MODEL_PATH, providers=providers)
                print(f"[ComicDetector] Loaded official Comic-Text-Detector ONNX model with providers: {_session.get_providers()}!")
            except Exception as e:
                print("[ComicDetector] Failed loading with GPU, fallback to CPU:", e)
                _session = ort.InferenceSession(MODEL_PATH, providers=['CPUExecutionProvider'])
    return _session

def _detect_comic_text_and_mask_single(img_bgr, session):
    h_orig, w_orig = img_bgr.shape[:2]
    target_size = 1024
    resized = cv2.resize(img_bgr, (target_size, target_size))
    inp = np.transpose(resized.astype(np.float32) / 255.0, (2, 0, 1))[np.newaxis, ...]
    
    outputs = session.run(None, {'images': inp})
    blk, seg, det = outputs
    
    # 1. Segmentation mask for inpainting
    seg_map = seg[0, 0]
    seg_mask = (seg_map > 0.25).astype(np.uint8) * 255
    seg_orig = cv2.resize(seg_mask, (w_orig, h_orig), interpolation=cv2.INTER_LINEAR)
    
    # Dilate slightly (2px) to cleanly cover text antialiasing
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    dilated_mask = cv2.dilate(seg_orig, kernel, iterations=2)
    
    # 2. Extract bounding boxes for text blocks
    contours, _ = cv2.findContours(seg_orig, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    # Group nearby line contours into bubbles
    line_rects = []
    for cnt in contours:
        if cv2.contourArea(cnt) > 25:
            x, y, w, h = cv2.boundingRect(cnt)
            line_rects.append({'x_min': x, 'y_min': y, 'x_max': x + w, 'y_max': y + h})
            
    # Cluster lines that belong to the same bubble
    line_rects = sorted(line_rects, key=lambda b: (b['y_min'], b['x_min']))
    bubble_boxes = []
    for r in line_rects:
        r_h = r['y_max'] - r['y_min']
        merged = False
        for bub in bubble_boxes:
            h_overlap = min(r['x_max'], bub['x_max']) - max(r['x_min'], bub['x_min'])
            v_gap = r['y_min'] - bub['y_max']
            
            # Only merge adjacent lines with tight vertical gap (never jump across illustrations)
            if h_overlap > -20 and -5 <= v_gap <= min(24, r_h * 1.2):
                bub['x_min'] = min(bub['x_min'], r['x_min'])
                bub['y_min'] = min(bub['y_min'], r['y_min'])
                bub['x_max'] = max(bub['x_max'], r['x_max'])
                bub['y_max'] = max(bub['y_max'], r['y_max'])
                merged = True
                break
        if not merged:
            bubble_boxes.append(r.copy())
            
    return dilated_mask, bubble_boxes

def _detect_comic_text_and_mask_tiled(img_bgr, session):
    """Processes long-strip webtoons in native-resolution tiles to prevent squashing distortions."""
    h_orig, w_orig = img_bgr.shape[:2]
    chunk_h = 2200
    overlap = 300
    step = chunk_h - overlap

    full_mask = np.zeros((h_orig, w_orig), dtype=np.uint8)
    all_boxes = []

    y_start = 0
    while y_start < h_orig:
        y_end = min(h_orig, y_start + chunk_h)
        crop = img_bgr[y_start:y_end, 0:w_orig]
        chunk_mask, chunk_boxes = _detect_comic_text_and_mask_single(crop, session)
        if chunk_mask is not None:
            full_mask[y_start:y_end, 0:w_orig] = np.maximum(
                full_mask[y_start:y_end, 0:w_orig], chunk_mask
            )
        for b in chunk_boxes:
            b_copy = b.copy()
            b_copy['y_min'] += y_start
            b_copy['y_max'] += y_start
            all_boxes.append(b_copy)
        if y_end >= h_orig:
            break
        y_start += step

    # Merge / cluster adjacent bubble boxes across chunk seams
    all_boxes = sorted(all_boxes, key=lambda b: (b['y_min'], b['x_min']))
    merged_bubbles = []
    for r in all_boxes:
        r_h = r['y_max'] - r['y_min']
        merged = False
        for bub in merged_bubbles:
            h_overlap = min(r['x_max'], bub['x_max']) - max(r['x_min'], bub['x_min'])
            v_gap = r['y_min'] - bub['y_max']
            if h_overlap > -20 and -10 <= v_gap <= min(24, r_h * 1.2):
                bub['x_min'] = min(bub['x_min'], r['x_min'])
                bub['y_min'] = min(bub['y_min'], r['y_min'])
                bub['x_max'] = max(bub['x_max'], r['x_max'])
                bub['y_max'] = max(bub['y_max'], r['y_max'])
                merged = True
                break
        if not merged:
            merged_bubbles.append(r.copy())

    return full_mask, merged_bubbles

def detect_comic_text_and_mask(img_bgr):
    """
    Runs the official deep-learning Comic-Text-Detector model on the image.
    Supports both standard manga pages and tall webtoon long-strips via automatic tiling.
    Returns:
      - seg_mask: Pixel-perfect binary inpaint mask (255 where text strokes exist)
      - bubble_boxes: List of detected speech bubble / text block bounds
    """
    session = get_detector_session()
    if session is None:
        return None, []
        
    h_orig, w_orig = img_bgr.shape[:2]
    if h_orig > 2400 and (h_orig / max(1, w_orig)) > 1.8:
        return _detect_comic_text_and_mask_tiled(img_bgr, session)
        
    return _detect_comic_text_and_mask_single(img_bgr, session)

