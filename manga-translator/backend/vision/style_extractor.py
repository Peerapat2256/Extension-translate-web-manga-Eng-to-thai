import numpy as np
import cv2

def rgb_to_hex(rgb):
    return "#{:02x}{:02x}{:02x}".format(int(rgb[0]), int(rgb[1]), int(rgb[2]))

def extract_style_from_crop(img_np, x_min, y_min, x_max, y_max):
    """
    World-class style extractor:
    Detects text color, bubble background color, stroke/outline color, and shadow.
    """
    H, W = img_np.shape[:2]
    x1, y1 = max(0, x_min), max(0, y_min)
    x2, y2 = min(W, x_max), min(H, y_max)
    
    if x2 <= x1 or y2 <= y1:
        return (255, 255, 255), (0, 0, 0), None, 0
        
    crop = img_np[y1:y2, x1:x2]
    if crop.ndim == 2:
        crop = cv2.cvtColor(crop, cv2.COLOR_GRAY2RGB)
    elif crop.shape[2] == 4:
        crop = cv2.cvtColor(crop, cv2.COLOR_RGBA2RGB)
    h, w, c = crop.shape
    
    # 1. Background color extraction from perimeter border
    border_px = max(1, min(3, min(h, w) // 10))
    border_mask = np.zeros((h, w), dtype=bool)
    border_mask[:border_px, :] = True
    border_mask[-border_px:, :] = True
    border_mask[:, :border_px] = True
    border_mask[:, -border_px:] = True
    
    border_pixels = crop[border_mask]
    if len(border_pixels) > 0:
        bg_color = tuple(int(x) for x in np.median(border_pixels, axis=0))
    else:
        bg_color = (255, 255, 255)
        
    # 2. Text color extraction: find pixels with high contrast from background
    diff = np.linalg.norm(crop.astype(float) - np.array(bg_color), axis=-1)
    text_mask = diff > 25
    text_pixels = crop[text_mask]
    
    stroke_color = (255, 255, 255)
    stroke_width = 1
    
    if len(text_pixels) > 0:
        # Measure saturation of actual text pixels
        sats = np.max(text_pixels[:, :3], axis=-1) - np.min(text_pixels[:, :3], axis=-1)
        med_sat = float(np.median(sats))
        
        if med_sat >= 18.0:
            # Saturated comic color: Orange, Cyan, Pink, Red, Yellow
            sat_mask = sats > 25
            if np.sum(sat_mask) > 10:
                text_color = tuple(int(x) for x in np.median(text_pixels[sat_mask], axis=0)[:3])
            else:
                text_color = tuple(int(x) for x in np.median(text_pixels, axis=0)[:3])
            stroke_color = (255, 255, 255)
            stroke_width = 3
        else:
            # Monochrome / Standard comic dialogue: Black or White
            bg_lum = 0.299 * bg_color[0] + 0.587 * bg_color[1] + 0.114 * bg_color[2]
            if bg_lum > 128:
                text_color = (0, 0, 0)
                stroke_color = (255, 255, 255)
                stroke_width = 2
            else:
                text_color = (255, 255, 255)
                stroke_color = (0, 0, 0)
                stroke_width = 2
    else:
        bg_lum = 0.299 * bg_color[0] + 0.587 * bg_color[1] + 0.114 * bg_color[2]
        text_color = (0, 0, 0) if bg_lum > 128 else (255, 255, 255)
        stroke_color = (255, 255, 255) if bg_lum > 128 else (0, 0, 0)
        stroke_width = 1

    # If background is bright near-white, default clean white
    bg_lum = 0.299 * bg_color[0] + 0.587 * bg_color[1] + 0.114 * bg_color[2]
    if bg_lum > 240:
        bg_color = (255, 255, 255)
        
    return bg_color, text_color, stroke_color, stroke_width
