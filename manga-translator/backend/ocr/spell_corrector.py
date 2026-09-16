import os
import re
from core.config import ENGLISH_WORDS_PATH, ENGLISH_WORDS_LARGE_PATH

WORDS_FREQ = {}
COMMON_WORDS = set()
if os.path.exists(ENGLISH_WORDS_PATH):
    try:
        with open(ENGLISH_WORDS_PATH, "r", encoding="utf-8") as f:
            for idx, line in enumerate(f):
                w = line.strip().lower()
                if w:
                    WORDS_FREQ[w] = 10000 - idx
                    COMMON_WORDS.add(w)
    except Exception:
        pass

if os.path.exists(ENGLISH_WORDS_LARGE_PATH):
    try:
        with open(ENGLISH_WORDS_LARGE_PATH, "r", encoding="utf-8") as f:
            for line in f:
                w = line.strip().lower()
                if w and w not in WORDS_FREQ:
                    WORDS_FREQ[w] = 10
    except Exception:
        pass

CONTRACTION_MAP = {
    "isnt": "isn't", "arent": "aren't", "wasnt": "wasn't", "werent": "weren't",
    "dont": "don't", "doesnt": "doesn't", "didnt": "didn't", "cant": "can't",
    "couldnt": "couldn't", "wont": "won't", "wouldnt": "wouldn't", "shouldnt": "shouldn't",
    "havent": "haven't", "hasnt": "hasn't", "hadnt": "hadn't",
    "im": "i'm", "youre": "you're", "hes": "he's", "shes": "she's",
    "theyre": "they're", "ive": "i've", "youve": "you've", "weve": "we've",
    "theyve": "they've", "youll": "you'll", "theyll": "they'll"
}
for k, v in CONTRACTION_MAP.items():
    WORDS_FREQ[k] = 9800
    WORDS_FREQ[v] = 9800

def clean_ocr_text(text):
    if not text:
        return ""
    # Strip non-text artifacts
    text = re.sub(r'[\$\~]+', '', text)
    # Underscores in comic fonts represent spaces or ellipsis, never empty string
    text = re.sub(r'\_+', ' ', text)
    # Fix colon / semicolon misread as clause punctuation
    text = re.sub(r':\s*(?=[A-Za-z])', '. ', text)
    text = re.sub(r';\s*(?=[A-Za-z])', ', ', text)
    # Fix colons/dots misread before question/exclamation marks (e.g. WHAT: :? -> WHAT...? or ASSIGNED:.:? -> ASSIGNED...?)
    text = re.sub(r'[:：\.]*[:：]+[\.\s]*[:：]*\?', '...?', text)
    text = re.sub(r'[:：\.]*[:：]+[\.\s]*[:：]*\!', '...!', text)
    # Fix hyphenated words across line wraps (e.g. Three- Line -> Three-Line)
    text = re.sub(r'(\w+)-\s+(\w+)', r'\1-\2', text)

    # Specific comic font typo fixes
    text = re.sub(r'\bDIArv\b|\bDIARV\b', 'DIARY', text, flags=re.IGNORECASE)
    text = re.sub(r'\bGROUTH\b', 'GROWTH', text, flags=re.IGNORECASE)
    text = re.sub(r'\bZHENZHENIS\b|\bZHENZHENS\b', "ZHENZHEN'S", text, flags=re.IGNORECASE)
    text = re.sub(r'\bCuvs\b', 'Guys', text)
    text = re.sub(r'\bWkere\b', 'Where', text)
    text = re.sub(r'\bVou\b', 'You', text)
    text = re.sub(r'\bYM\b', "I'M", text)
    text = re.sub(r'\bSTARTA\b', 'START?', text)
    # Fix digit 6 -> G at end of -IN6
    text = re.sub(r'([a-zA-Z]{2,})in6\b', r'\1ing', text, flags=re.IGNORECASE)
    # Fix common comic font OCR leetspeak misreads
    text = re.sub(r'(?<=[a-zA-Z])4(?=[a-zA-Z])', 'a', text)
    text = re.sub(r'\b[sS]4y\b', 'say', text)
    text = re.sub(r'(?<=[a-zA-Z])5(?=[a-zA-Z])', 's', text)
    # Fix digit 0 inside words -> o
    text = re.sub(r'(?<=[a-zA-Z])0(?=[a-zA-Z])', 'o', text)
    # Fix digit 1 inside words -> l
    text = re.sub(r'(?<=[a-zA-Z])1(?=[a-zA-Z])', 'l', text)
    
    # Expand contractions and normalize erratic mixed-case lettering
    words = text.split()
    fixed_words = []
    for w in words:
        punct = re.findall(r'[^a-zA-Z0-9]+$', w)
        p_str = punct[0] if punct else ''
        w_core = w[:-len(p_str)] if p_str else w
        w_lower = re.sub(r'[^a-zA-Z]', '', w_core).lower()
        
        # Check contraction
        if w_lower in CONTRACTION_MAP:
            lead_cap = w_core[0].isupper() if w_core else False
            ct = CONTRACTION_MAP[w_lower]
            if lead_cap:
                ct = ct.capitalize()
            fixed_words.append(ct + p_str)
            continue
            
        # Normalize erratic mixed case (e.g. FiLLed -> filled, EXpEcT -> expect, ReTUrn -> return)
        pure = re.sub(r'[^a-zA-Z]', '', w_core)
        if len(pure) >= 2:
            if not (pure.isupper() or pure.islower() or (pure[0].isupper() and pure[1:].islower())):
                w_core = w_core.lower()
                
        fixed_words.append(w_core + p_str)
        
    text = " ".join(fixed_words)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

COMIC_INTERJECTIONS = {
    "ah", "aha", "argh", "bam", "bang", "beep", "boom", "clang", "clank", "clap",
    "click", "clack", "crash", "creak", "cry", "ding", "drip", "drop", "eek", "eh",
    "gasp", "glance", "glare", "giggle", "grab", "grin", "groan", "growl", "gulp",
    "ha", "haha", "hahaha", "heh", "hehe", "hiss", "hm", "hmm", "hmmm", "hop", "huh",
    "huff", "knock", "moan", "mumble", "munch", "nod", "oops", "ouch", "pant", "peek",
    "phew", "ping", "plop", "pop", "puff", "roar", "rumble", "rustle", "scream",
    "screech", "shh", "shout", "shudder", "sigh", "slam", "slap", "slash", "slide",
    "smack", "smirk", "snap", "snicker", "snort", "sob", "splash", "squeak", "squeal",
    "stare", "step", "swish", "swoosh", "tap", "tch", "thud", "thump", "tick", "tsk",
    "twinkle", "twitch", "ugh", "urgh", "wait", "wham", "whimper", "whine", "whip",
    "whisper", "whoosh", "wink", "wipe", "woah", "wow", "yawn", "yell", "yelp", "yes", "no"
}

VALID_TWO_LETTER_WORDS = {
    "am", "an", "as", "at", "be", "by", "do", "go", "he", "hi", "if", "in", "is",
    "it", "me", "my", "no", "of", "oh", "ok", "on", "or", "so", "to", "up", "us", "we"
}

def is_cjk_or_hangul(text: str) -> bool:
    """Detects Korean (Hangul), Japanese (Kana/Kanji), and Chinese characters."""
    if not text:
        return False
    return bool(re.search(
        r'[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f'  # Korean Hangul
        r'\u3040-\u30ff'                             # Japanese Hiragana/Katakana
        r'\u4e00-\u9fff]',                           # CJK Ideographs (Kanji/Hanzi)
        text
    ))

def is_valid_english_dialogue(text: str, conf: float = 1.0) -> bool:
    """
    Intelligent English dialogue validator for Manga/Manhwa scanlations:
    - Filters out raw Korean/Japanese SFX (e.g. 또각, 쿵, ざわざわ)
    - Filters out OCR hallucinated garbage (e.g. 'W4', 'Ylls', 'lll', '0o', 'v')
    - Recognizes genuine English dialogue, contractions, and comic sound words
    """
    if not text:
        return False
        
    # 1. If text contains Korean/Japanese/Chinese glyphs, it is NOT English
    if is_cjk_or_hangul(text):
        return False

    # 2. Filter scanlation group URLs and credit watermarks (e.g. discord.gg/..., patreon, CL/RD)
    if re.search(r'\b(?:discord\.gg|https?://|www\.|patreon\.com|\.com/|\.net/|\.org/)\b', text, flags=re.IGNORECASE):
        return False
    if re.fullmatch(r'\s*(?:CL/?RD|CLIRD|TS|PR|TL|RP|QC|RAW|ED)\s*', text, flags=re.IGNORECASE):
        return False
        
    # 3. Extract pure alphabetical tokens
    cleaned = re.sub(r'[^a-zA-Z\s]', ' ', text).strip()
    words = [w.lower() for w in cleaned.split() if len(w) > 0]
    
    if not words:
        return False
        
    # 3. Low confidence check: reject gibberish SFX, but preserve genuine English words (e.g. 'DEFINITELY SURPASS')
    if conf < 0.20 and len(words) <= 2:
        has_dict = all(w in COMMON_WORDS or w in CONTRACTION_MAP or w in VALID_TWO_LETTER_WORDS for w in words)
        if not has_dict:
            return False
        
    # 4. Check for digit-attached words like "W4", "A1", "X2" from Korean stroke misreads
    if re.search(r'\b[A-Za-z]\d+\b|\b\d+[A-Za-z]\b', text):
        non_num_words = [w for w in words if not any(c.isdigit() for c in w)]
        if not non_num_words:
            return False
            
    # 5. Single-word validation
    if len(words) == 1:
        w = words[0]
        if len(w) == 1:
            return w in {'a', 'i'}
        if len(w) == 2:
            return w in VALID_TWO_LETTER_WORDS or w in COMIC_INTERJECTIONS
        # Check dictionary & comic interjections
        if w in COMMON_WORDS or w in COMIC_INTERJECTIONS or w in CONTRACTION_MAP:
            return True
        # If word has vowels and good confidence, check if in large dictionary
        if any(v in w for v in 'aeiouy') and (w in WORDS_FREQ or conf > 0.65):
            if not re.search(r'[^aeiouy]{4,}', w):
                return True
        return False
        
    # 6. Multi-word sentence validation
    valid_count = 0
    for w in words:
        if len(w) == 1 and w in {'a', 'i'}:
            valid_count += 1
        elif len(w) == 2 and (w in VALID_TWO_LETTER_WORDS or w in COMIC_INTERJECTIONS):
            valid_count += 1
        elif w in COMMON_WORDS or w in COMIC_INTERJECTIONS or w in CONTRACTION_MAP or w in WORDS_FREQ:
            valid_count += 1
        elif any(v in w for v in 'aeiouy') and not re.search(r'[^aeiouy]{4,}', w):
            valid_count += 0.5
            
    # At least 35% of words must be valid English
    return (valid_count / len(words)) >= 0.35

def is_watermark_or_noise(text: str, conf: float = 1.0) -> bool:
    """
    Intelligent filter for scanlator anti-theft hashes, credit watermarks, and OCR noise.
    Filters out tokens like:
    - 'E5at8t34', 'HORBEc45e8e', '97e3ha7', 'dsae6', 'c45e8e', '6e', 'E3GE'
    - Discord / credit watermark tokens like 'DISCORD66/', 'PERHVCXDRX'
    - Standalone numbers or noise with low confidence
    """
    if not text:
        return True
        
    t = text.strip()
    if not t:
        return True

    # Scanlator credits / links
    if re.search(r'\b(?:discord\.(?:gg|me)|patreon\.com|flamecomics|asurascans|reaperscans|voidscans)\b', t, re.IGNORECASE):
        return True

    words = re.findall(r"[A-Za-z0-9']+", t)
    if not words:
        return True

    # 1. Pure digits check
    pure_num = re.sub(r'[\"\']', '', t)
    if pure_num.isdigit() and (conf < 0.6 or len(pure_num) > 3):
        return True

    # 2. Token-level classification
    bad_tokens = 0
    valid_words = 0
    for w in words:
        if re.match(r'^\d+(?:st|nd|rd|th)$', w, re.IGNORECASE):
            valid_words += 1
            continue
            
        low = re.sub(r'[^a-zA-Z]', '', w).lower()
        if low in COMMON_WORDS or low in CONTRACTION_MAP or low in VALID_TWO_LETTER_WORDS or low in COMIC_INTERJECTIONS or low in WORDS_FREQ:
            valid_words += 1
            continue

        has_alpha = any(c.isalpha() for c in w)
        has_digit = any(c.isdigit() for c in w)

        if has_alpha and has_digit:
            bad_tokens += 1
        elif len(w) >= 3 and has_alpha and not any(v in low for v in 'aeiouy') and low not in COMIC_INTERJECTIONS:
            bad_tokens += 1
        elif len(low) <= 1 and low not in {'a', 'i'}:
            bad_tokens += 0.5
        elif conf < 0.20 and low not in WORDS_FREQ and low not in COMIC_INTERJECTIONS:
            bad_tokens += 1.0
        elif conf < 0.35 and low not in WORDS_FREQ:
            bad_tokens += 0.5

    # Short clusters (1-3 tokens) containing scanlator watermark hashes -> drop
    if len(words) <= 3:
        if bad_tokens >= 1:
            return True
    else:
        # Long dialogue: drop only if bad tokens outnumber valid words
        if bad_tokens > valid_words:
            return True

    return False


