import numpy as np
import math

def color_dist(c1, c2):
    return math.sqrt((c1[0]-c2[0])**2 + (c1[1]-c2[1])**2 + (c1[2]-c2[2])**2)

def cluster_lines_into_bubbles(line_boxes):
    """
    World-Class Connected-Component Bubble Clustering:
    1. Rotation-aware coordinate projection (merges staggered words on slanted narration)
    2. Color-compatibility grouping (keeps different speaker colors separate)
    3. Preserves original line polygons for precision stroke inpainting
    4. Eliminates fragmented words and overlapping text collisions
    """
    if not line_boxes:
        return []
        
    n = len(line_boxes)
    parent = list(range(n))
    
    def find(i):
        if parent[i] == i:
            return i
        parent[i] = find(parent[i])
        return parent[i]
        
    def union(i, j):
        root_i, root_j = find(i), find(j)
        if root_i != root_j:
            parent[root_i] = root_j

    # Connect boxes that are physically part of the same speech bubble
    for i in range(n):
        for j in range(i + 1, n):
            b1 = line_boxes[i]
            b2 = line_boxes[j]
            
            h1 = b1['y_max'] - b1['y_min']
            h2 = b2['y_max'] - b2['y_min']
            avg_h = (h1 + h2) / 2.0

            # Angle compatibility (only separate if fundamentally different)
            a1 = b1.get('angle', 0.0)
            a2 = b2.get('angle', 0.0)
            if abs(a1 - a2) > 35.0:
                continue

            # Color compatibility
            c1 = b1.get('color')
            c2 = b2.get('color')
            cdist = color_dist(c1[:3], c2[:3]) if (c1 and c2) else 0.0

            # Rotation-projected coordinates
            rad = math.radians(-a1)
            cos_a, sin_a = math.cos(rad), math.sin(rad)
            cx1, cy1 = (b1['x_min'] + b1['x_max']) / 2.0, (b1['y_min'] + b1['y_max']) / 2.0
            cx2, cy2 = (b2['x_min'] + b2['x_max']) / 2.0, (b2['y_min'] + b2['y_max']) / 2.0
            
            p_y1 = cx1 * sin_a + cy1 * cos_a
            p_y2 = cx2 * sin_a + cy2 * cos_a
            p_x1 = cx1 * cos_a - cy1 * sin_a
            p_x2 = cx2 * cos_a - cy2 * sin_a
            
            delta_v = abs(p_y1 - p_y2)
            delta_h = abs(p_x1 - p_x2)
            
            # Words on the same line (slanted or horizontal)
            if delta_v < avg_h * 0.7:
                w_sum = ((b1['x_max'] - b1['x_min']) + (b2['x_max'] - b2['x_min'])) / 2.0
                if delta_h < w_sum + avg_h * 2.0:
                    # Allow minor shade shifts due to art background
                    if cdist < 110.0:
                        union(i, j)
                        continue
                        
            # Vertically stacked lines in the same speech bubble
            if delta_v < avg_h * 2.2 and delta_h < avg_h * 4.0:
                if cdist < 80.0:
                    union(i, j)
                
    clusters = {}
    for i in range(n):
        root = find(i)
        clusters.setdefault(root, []).append(line_boxes[i])
        
    # Assemble complete sentences per bubble
    unified_bubbles = []
    for line_list in clusters.values():
        x_min = min(l['x_min'] for l in line_list)
        y_min = min(l['y_min'] for l in line_list)
        x_max = max(l['x_max'] for l in line_list)
        y_max = max(l['y_max'] for l in line_list)
        
        # Calculate robust average angle
        all_angles = [l.get('angle', 0.0) for l in line_list]
        h_count = sum(1 for a in all_angles if abs(a) <= 3.0)
        if h_count >= len(all_angles) * 0.5:
            avg_angle = 0.0
        else:
            avg_angle = float(np.median(all_angles))
        
        # Sort lines inside bubble using rotation-aware projection & vertical line clustering
        rad = math.radians(-avg_angle)
        cos_a = math.cos(rad)
        sin_a = math.sin(rad)
        
        items = []
        for l in line_list:
            cx = (l['x_min'] + l['x_max']) / 2.0
            cy = (l['y_min'] + l['y_max']) / 2.0
            h = l['y_max'] - l['y_min']
            py = cx * sin_a + cy * cos_a
            px = cx * cos_a - cy * sin_a
            items.append({'box': l, 'py': py, 'px': px, 'h': h})
            
        items.sort(key=lambda it: it['py'])
        
        grouped_lines = []
        for it in items:
            matched_group = None
            for group in grouped_lines:
                avg_py = sum(g['py'] for g in group) / len(group)
                avg_h = sum(g['h'] for g in group) / len(group)
                if abs(it['py'] - avg_py) < avg_h * 0.45:
                    matched_group = group
                    break
            if matched_group is not None:
                matched_group.append(it)
            else:
                grouped_lines.append([it])
                
        lines_sorted = []
        for group in grouped_lines:
            group.sort(key=lambda it: it['px'])
            lines_sorted.extend([g['box'] for g in group])
        
        # Combine text into a coherent sentence
        raw_texts = [l['text'].strip() for l in lines_sorted if l['text'].strip()]
        combined_text = " ".join(raw_texts)
        
        unified_bubbles.append({
            'x_min': x_min,
            'y_min': y_min,
            'x_max': x_max,
            'y_max': y_max,
            'text': combined_text,
            'angle': avg_angle,
            'lines': lines_sorted,
            'lines_count': len(lines_sorted)
        })
        
    return unified_bubbles

def find_bubble_bounds_and_mask(img_bgr, text_box):
    """
    Finds the exact speech bubble / box boundaries enclosing a text box
    using color floodFill and solid contour analysis.
    Guarantees that:
    1. Inpainting NEVER crosses the bubble border / outline into artwork.
    2. Typesetting gets the full interior dimensions of the bubble.
    3. Handles single bubbles, ovals, rectangular caption boxes, and stepped/connected bubbles.
    """
    import cv2
    h_img, w_img = img_bgr.shape[:2]
    y1, x1, y2, x2 = text_box
    if y2 <= y1 or x2 <= x1:
        return text_box, None, (255, 255, 255)
    crop = img_bgr[y1:y2, x1:x2]
    if crop.size == 0:
        return text_box, None, (255, 255, 255)
        
    border_px = np.concatenate([crop[0, :], crop[-1, :], crop[:, 0], crop[:, -1]])
    bg_col = np.median(border_px, axis=0).astype(np.uint8)
    bg_lum = 0.114 * bg_col[0] + 0.587 * bg_col[1] + 0.299 * bg_col[2]
    
    # Only expand if the background inside text is a uniform bright bubble or box
    if not (bg_lum > 140):
        return text_box, None, bg_col
        
    diff = np.linalg.norm(img_bgr.astype(float) - bg_col.astype(float), axis=-1)
    cx = (x1 + x2) // 2
    cy = (y1 + y2) // 2
    sample_y, sample_x = cy, cx
    min_diff = diff[cy, cx]
    for dy in range(-12, 13, 4):
        for dx in range(-12, 13, 4):
            ny, nx = max(0, min(h_img-1, cy + dy)), max(0, min(w_img-1, cx + dx))
            if diff[ny, nx] < min_diff:
                min_diff = diff[ny, nx]
                sample_y, sample_x = ny, nx
                
    if min_diff > 35:
        for py, px in [(y1, cx), (y2-1, cx), (cy, x1), (cy, x2-1)]:
            if diff[py, px] < min_diff:
                min_diff = diff[py, px]
                sample_y, sample_x = py, px
                
    if min_diff > 45:
        return text_box, None, bg_col
        
    ff_mask = np.zeros((h_img + 2, w_img + 2), dtype=np.uint8)
    tolerance = 32
    flags = 4 | (255 << 8) | cv2.FLOODFILL_MASK_ONLY
    cv2.floodFill(
        img_bgr.copy(), ff_mask, (sample_x, sample_y),
        newVal=0,
        loDiff=(tolerance, tolerance, tolerance),
        upDiff=(tolerance, tolerance, tolerance),
        flags=flags
    )
    
    bubble_interior = ff_mask[1:h_img+1, 1:w_img+1]
    flooded_area = np.sum(bubble_interior > 0)
    page_area = h_img * w_img
    if flooded_area > page_area * 0.25 or flooded_area < (x2 - x1) * (y2 - y1) * 0.5:
        return text_box, None, bg_col
        
    # Erode interior mask 2px to strictly avoid touching the border outline
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    safe_interior = cv2.erode(bubble_interior, kernel, iterations=2)
    
    # Fill text holes inside the bubble interior to obtain a continuous solid region
    contours, _ = cv2.findContours(bubble_interior, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    solid = np.zeros_like(bubble_interior)
    cv2.drawContours(solid, contours, -1, 255, -1)
    
    # Expand vertically from text_box along columns inside the text box
    sub_col = solid[:, x1:x2]
    by1 = y1
    while by1 > 0 and np.mean(sub_col[by1-1, :]) > 180:
        by1 -= 1
    by2 = y2
    while by2 < h_img - 1 and np.mean(sub_col[by2+1, :]) > 180:
        by2 += 1
        
    # Expand horizontally along rows inside [by1, by2]
    sub_row = solid[y1:y2, :]
    bx1 = x1
    while bx1 > 0 and np.mean(sub_row[:, bx1-1]) > 180:
        bx1 -= 1
    bx2 = x2
    while bx2 < w_img - 1 and np.mean(sub_row[:, bx2+1]) > 180:
        bx2 += 1
        
    bx1 = min(bx1, x1)
    bx2 = max(bx2, x2)
    by1 = min(by1, y1)
    by2 = max(by2, y2)
    
    return [by1, bx1, by2, bx2], safe_interior, bg_col

