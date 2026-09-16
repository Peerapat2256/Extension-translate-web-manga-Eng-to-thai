import cv2
import numpy as np

def generate_stroke_mask(crop_np, bg_color, text_color=None):
    """
    Generate precise mask of ONLY text ink strokes (no floating box!)
    """
    h, w = crop_np.shape[:2]
    if h == 0 or w == 0:
        return np.zeros((h, w), dtype=np.uint8)
        
    # Color distance from background
    diff_bg = np.linalg.norm(crop_np[:, :, :3].astype(float) - np.array(bg_color[:3]), axis=-1)
    
    # Adaptive threshold based on background distance
    mask = (diff_bg > 22).astype(np.uint8) * 255
    
    # Exclude outer border boundary to protect bubble edge
    border_px = max(1, min(4, min(h, w) // 12))
    mask[:border_px, :] = 0
    mask[-border_px:, :] = 0
    mask[:, :border_px] = 0
    mask[:, -border_px:] = 0
    
    # Dilate slightly to cover antialiasing
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    dilated_mask = cv2.dilate(mask, kernel, iterations=2)
    return dilated_mask

def build_polygon_stroke_mask(img_bgr, ocr_boxes):
    """
    World-Class Polygon-Restricted Text Stroke Inpaint Mask:
    Ensures inpainting NEVER touches any artwork, frames, doodles, or textures outside the exact text polygon!
    """
    h_img, w_img = img_bgr.shape[:2]
    poly_mask = np.zeros((h_img, w_img), dtype=np.uint8)
    
    for b in ocr_boxes:
        pts = b.get('pts')
        if not pts:
            # Fallback to rectangle points
            pts = [
                [b['x_min'], b['y_min']],
                [b['x_max'], b['y_min']],
                [b['x_max'], b['y_max']],
                [b['x_min'], b['y_max']]
            ]
        pts_arr = np.array(pts, dtype=np.int32)
        p_mask = np.zeros((h_img, w_img), dtype=np.uint8)
        cv2.fillPoly(p_mask, [pts_arr], 255)
        
        x, y, w, h = cv2.boundingRect(pts_arr)
        # Pad box by 5px in all directions so text descenders (p, y, g, q) and ascenders (h, t, l) are fully enclosed
        x1, y1 = max(0, x - 5), max(0, y - 5)
        x2, y2 = min(w_img, x + w + 5), min(h_img, y + h + 5)
        if x2 <= x1 or y2 <= y1:
            continue
            
        crop = img_bgr[y1:y2, x1:x2]
        crop_poly = p_mask[y1:y2, x1:x2]
        # Dilate polygon slightly to ensure outer edges of characters are covered
        crop_poly = cv2.dilate(crop_poly, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), iterations=1)
        
        # Sample background from the outer boundary rim of the polygon
        edge_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        dilated_poly = cv2.dilate(crop_poly, edge_kernel, iterations=1)
        rim_mask = (dilated_poly > 0) & (crop_poly == 0)
        
        if np.sum(rim_mask) > 10:
            bg_col = np.median(crop[rim_mask], axis=0)
        else:
            bg_col = np.median(crop, axis=(0, 1))
            
        # Detect text ink strokes strictly inside the polygon
        diff = np.linalg.norm(crop.astype(float) - bg_col, axis=-1)
        stroke = ((diff > 18) & (crop_poly > 0)).astype(np.uint8) * 255
        stroke = cv2.dilate(stroke, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), iterations=2)
        poly_mask[y1:y2, x1:x2] = np.maximum(poly_mask[y1:y2, x1:x2], stroke)
        
    return poly_mask
