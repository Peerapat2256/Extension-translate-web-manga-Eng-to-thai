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
