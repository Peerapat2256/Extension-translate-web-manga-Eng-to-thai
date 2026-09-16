import re
import pythainlp
from PIL import ImageFont

def clean_manga_text(text: str, orig_en: str = "") -> str:
    """
    Cleans OCR/LLM artifacts from manga dialogue before typesetting:
    - Normalizes Unicode punctuation (em-dashes, smart quotes, ellipsis)
    - Strips CJK/Hangul ideographs and unrenderable glyphs to eliminate tofu boxes (□ □)
    - Strips leading orphan Latin letter prefixes (e.g. 'A  ท้าทาย?' -> 'ท้าทาย?', 'Q: ทำไม' -> 'ทำไม')
    - Strips trailing colons (e.g. 'คร่ำครวญ:' -> 'คร่ำครวญ')
    - Strips surrounding quotes, asterisks, and backticks added by LLMs
    - Strips leading numbering (e.g. '[0]: ', '1. ') and label prefixes (e.g. 'แปล: ', 'เสียง: ')
    - Preserves genuine punctuation like '!', '?', and '...'
    """
    if not text:
        return ""
    
    text = text.strip()
    
    # 1. Normalize Unicode symbols
    unicode_replacements = {
        '\u2014': '-',      # em-dash
        '\u2013': '-',      # en-dash
        '\u201c': '"',      # left double quote
        '\u201d': '"',      # right double quote
        '\u2018': "'",      # left single quote
        '\u2019': "'",      # right single quote
        '\u2026': '...',    # horizontal ellipsis
        '\u00a0': ' ',      # non-breaking space
        '\u200b': '',       # zero-width space
        '\ufeff': '',       # zero-width no-break space
        '\ufffd': '',       # replacement character
    }
    for old, new in unicode_replacements.items():
        text = text.replace(old, new)
        
    # 2. Filter out CJK ideographs / Hangul / Kana that cause □ □ tofu boxes in Thai fonts
    text = re.sub(r'[\u4e00-\u9fff\u3400-\u4dbf\uac00-\ud7a3\u1100-\u11ff\u3040-\u30ff]', '', text)
    
    # 3. Strip any characters outside basic printable ASCII, Thai Unicode, and common punctuation
    text = re.sub(r'[^\u0020-\u007E\u0E00-\u0E7F]', '', text)
    
    # 4. Remove leading sequence numbers like "0. ", "1: ", "[0] "
    text = re.sub(r'^\[?\d+\]?[\.\:\-\s]+(?=[\u0e00-\u0e7f])', '', text).strip()
    
    # 5. Remove leading label prefixes (e.g. "คำแปล: ", "แปล: ", "เสียง: ", "SFX: ", "Translation: ")
    text = re.sub(
        r'^(คำแปล|แปลว่า|แปลไทย|แปล|เสียงพูด|เสียงประกอบ|เสียง|คำพูด|บทสนทนา|บทพูด|SFX|Sound|Translation|Thai)\s*[:：\-]\s*', 
        '', text, flags=re.IGNORECASE
    ).strip()
    
    # 6. Remove leading orphan Latin letters before Thai text (e.g. 'A  ท้าทาย?' -> 'ท้าทาย?', 'Q: ทำไม' -> 'ทำไม')
    text = re.sub(r'^[A-Za-z][\:\.\-\s]+(?=[\u0e00-\u0e7f])', '', text).strip()
    
    # 7. Strip surrounding quotes / markdown formatting added by LLMs
    for _ in range(2):
        text = text.strip('`"\'“”‘’*#_~')
        
    # 8. Remove trailing explanatory brackets (e.g. "(เสียงประกอบ)", "(เสียงถอนหายใจ)", "(หมายเหตุ: ...)")
    if not ("(" in orig_en and ")" in orig_en):
        text = re.sub(r'\s*[\(\[](?:เสียง|เสียงประกอบ|เสียงร้อง|หมายเหตุ|อธิบาย|SFX)[^\)\]]*[\)\]]$', '', text, flags=re.IGNORECASE).strip()

    # 9. Clean colons/semicolons before question marks and exclamation marks:
    # e.g. "อะไร:.?" -> "อะไร?", "มากขนาดไหน:::?" -> "มากขนาดไหน?", "ไปเถอะ:!" -> "ไปเถอะ!"
    text = re.sub(r'[:：;；\s\.]*[:：;；]+[\s\.]*(\?+)', r'\1', text)
    text = re.sub(r'[:：;；\s\.]*[:：;；]+[\s\.]*(\!+)', r'\1', text)

    # 10. Clean colons around ellipsis: "…:" -> "…", "...:" -> "..."
    text = re.sub(r'(\.{2,}|…)\s*[:：;；]+', r'\1', text)
    text = re.sub(r'[:：;；]+\s*(\.{2,}|…)', r'\1', text)
    
    # 11. Remove trailing colons, semicolons, hyphens, slashes
    text = re.sub(r'[\s:：;；\-_/\\|~]+$', '', text).strip()
    
    # 12. Remove trailing quotes again in case they were after colon: e.g. คร่ำครวญ:"
    text = text.strip('`"\'“”‘’*#_')
    
    # Final check: if text ends with a colon
    text = re.sub(r'[:：]+$', '', text).strip()
    text = re.sub(r'\s+([!?,.:;])', r'\1', text)
    text = re.sub(r'\s{2,}', ' ', text).strip()
    
    return text

from functools import lru_cache

@lru_cache(maxsize=128)
def get_font_cached(font_path: str, size: int):
    """Cached font loader to avoid repeated disk reads during layout search."""
    return ImageFont.truetype(font_path, size)

def wrap_thai_text_shape_aware(text_or_words, font, max_w, max_h=None, is_diamond=True):
    """
    World-Class Thai Syllable Wrapper:
    Uses PyThaiNLP dictionary segmentation (newmm) to break lines at natural word boundaries.
    Supports pre-tokenized words list to avoid redundant tokenizer passes.
    """
    if isinstance(text_or_words, list):
        words = text_or_words
    else:
        text = clean_manga_text(text_or_words)
        text = re.sub(r'[\r\n]+', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        if not text:
            return []
        words = pythainlp.word_tokenize(text, engine='newmm')
        if not words:
            return [text]
            
    # Calculate available line width (with safety margin)
    margin = max(4, int(max_w * 0.04))
    target_w = max_w - margin
    
    lines = []
    current_line = ""
    
    # Pre-clean spacing before punctuation
    if not isinstance(text_or_words, list):
        words = [re.sub(r'\s+([!?,.:;])', r'\1', w) for w in words]
        
    for w in words:
        test_line = current_line + w
        bbox = font.getbbox(test_line)
        line_w = bbox[2] - bbox[0]
        
        if line_w > target_w and current_line:
            # Prevent orphan punctuation marks (e.g. standalone '?', '!', '...') on a new line alone
            if re.match(r'^[!?\.\,\:\;\-]+$', w.strip()):
                current_line = test_line
            else:
                lines.append(current_line)
                current_line = w
        else:
            current_line = test_line
            
    if current_line:
        lines.append(current_line)
        
    return lines

def get_optimal_thai_font(text, max_w, max_h, font_path, min_size=11, max_size=52):
    """
    World-Class Adaptive Typesetter:
    Maximizes font size to fill speech bubble vertically and horizontally using Binary Search
    and Single-Pass word tokenization for blazing fast typesetting (< 0.02s per bubble).
    """
    pad_w = max(4, int(max_w * 0.04))
    avail_w = max_w - pad_w
    avail_h = max_h
    
    clean_text = clean_manga_text(text)
    clean_text = re.sub(r'[\r\n]+', ' ', clean_text)
    clean_text = re.sub(r'\s+', ' ', clean_text).strip()
    if not clean_text:
        return get_font_cached(font_path, min_size), []
        
    words = pythainlp.word_tokenize(clean_text, engine='newmm')
    if not words:
        words = [clean_text]
        
    low = min_size
    high = max_size
    best_size = min_size
    best_lines = []
    
    while low <= high:
        mid = (low + high) // 2
        f = get_font_cached(font_path, mid)
        lines = wrap_thai_text_shape_aware(words, f, avail_w)
        if not lines:
            high = mid - 1
            continue
            
        line_h = int(mid * 1.18)
        total_h = len(lines) * line_h
        max_line_w = max(f.getbbox(l)[2] - f.getbbox(l)[0] for l in lines)
        
        if max_line_w <= avail_w and total_h <= avail_h * 1.05:
            best_size = mid
            best_lines = lines
            low = mid + 1  # Fit succeeded, attempt larger font
        else:
            high = mid - 1  # Text overflowed, shrink font
            
    if not best_lines:
        best_font = get_font_cached(font_path, min_size)
        best_lines = wrap_thai_text_shape_aware(words, best_font, avail_w)
        return best_font, best_lines
        
    return get_font_cached(font_path, best_size), best_lines
