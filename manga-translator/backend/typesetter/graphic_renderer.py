from PIL import Image, ImageDraw, ImageFont
from core.config import TAHOMA_BOLD_FONT, DEFAULT_THAI_FONT
from typesetter.thai_formatter import get_optimal_thai_font
import os

_DEFAULT_CANDIDATES = [
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "THSarabunNew-Bold.ttf"),
    r"C:\Windows\Fonts\THSarabunNew Bold.ttf",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "Sarabun-Regular.ttf"),
    TAHOMA_BOLD_FONT,
    DEFAULT_THAI_FONT
]
FONT_PATH = next((p for p in _DEFAULT_CANDIDATES if os.path.exists(p)), DEFAULT_THAI_FONT)

def render_manga_text(img_pil, x_min, y_min, x_max, y_max, text_thai, 
                      text_color, stroke_color=None, stroke_width=0, angle=0.0):
    """
    World-Class Typesetting Renderer:
    Renders text with original color, matching stroke/shadow, and exact rotation angle.
    """
    if not text_thai or text_thai.strip() == "":
        return
        
    box_w = max(10, x_max - x_min)
    box_h = max(10, y_max - y_min)
    
    font, lines = get_optimal_thai_font(text_thai, box_w, box_h, FONT_PATH)
    font_size = font.size
    line_h = int(font_size * 1.20)
    total_h = len(lines) * line_h
    
    # Convert colors safely to standard int tuples
    if hasattr(text_color, "tolist"):
        text_color = tuple(int(x) for x in text_color.tolist()[:3])
    elif isinstance(text_color, (list, tuple)):
        text_color = tuple(int(x) for x in text_color[:3])
    else:
        text_color = (0, 0, 0)
        
    if stroke_color is not None:
        if hasattr(stroke_color, "tolist"):
            stroke_color = tuple(int(x) for x in stroke_color.tolist()[:3])
        elif isinstance(stroke_color, (list, tuple)):
            stroke_color = tuple(int(x) for x in stroke_color[:3])
        else:
            stroke_color = (255, 255, 255)
    else:
        # Default stroke: only for light text or when stroke_width was explicitly > 0
        lum = 0.299 * text_color[0] + 0.587 * text_color[1] + 0.114 * text_color[2]
        stroke_color = (255, 255, 255) if lum < 128 else (0, 0, 0)
        if stroke_width is None:
            stroke_width = 0
        
    if abs(angle) > 2.5:
        # Rotated text rendering via transparent layer
        pad_factor = 1.4
        layer_w = int(box_w * pad_factor)
        layer_h = int(box_h * pad_factor)
        
        layer = Image.new("RGBA", (layer_w, layer_h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        
        y_start = (layer_h - total_h) // 2
        for l in lines:
            bbox = font.getbbox(l)
            l_w = bbox[2] - bbox[0]
            x_pos = (layer_w - l_w) // 2
            draw.text((x_pos, y_start), l, font=font, 
                      fill=text_color + (255,), 
                      stroke_width=stroke_width, 
                      stroke_fill=stroke_color + (255,))
            y_start += line_h
            
        rotated = layer.rotate(-angle, resample=Image.BICUBIC, expand=False)
        paste_x = x_min - (layer_w - box_w) // 2
        paste_y = y_min - (layer_h - box_h) // 2
        img_pil.paste(rotated, (paste_x, paste_y), rotated)
    else:
        # Horizontal centered rendering
        draw = ImageDraw.Draw(img_pil)
        y_start = y_min + (box_h - total_h) // 2
        for l in lines:
            bbox = font.getbbox(l)
            l_w = bbox[2] - bbox[0]
            x_pos = x_min + (box_w - l_w) // 2
            draw.text((x_pos, y_start), l, font=font, 
                      fill=text_color, 
                      stroke_width=stroke_width, 
                      stroke_fill=stroke_color)
            y_start += line_h
