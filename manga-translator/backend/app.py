import io
import os
import base64
import easyocr
import time
import uvicorn
import re
import hashlib
import numpy as np
import cv2
from collections import OrderedDict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image, ImageDraw, ImageFont, ImageEnhance, ImageFilter, UnidentifiedImageError
from deep_translator import GoogleTranslator

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
THAI_FONT_PATH = os.path.join(BASE_DIR, "Sarabun-Regular.ttf")

# Load environment variables from .env file if present
env_path = os.path.join(os.path.dirname(__file__), ".env")
if not os.path.exists(env_path):
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
if os.path.exists(env_path):
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    key, val = line.split("=", 1)
                    os.environ[key.strip()] = val.strip()
    except Exception as e:
        print("Failed to load .env file:", e)

try:
    from google import genai
    HAS_GENAI = True
except ImportError:
    HAS_GENAI = False

# Set environment flags for PaddlePaddle / PaddleOCR compatibility
os.environ["FLAGS_use_onednn"] = "0"
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

try:
    from paddleocr import PaddleOCR
    HAS_PADDLEOCR = True
except ImportError:
    HAS_PADDLEOCR = False

try:
    from pythainlp import word_tokenize
    HAS_PYTHAINLP = True
except ImportError:
    HAS_PYTHAINLP = False

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Loading EasyOCR Models...")
import torch
use_gpu = torch.cuda.is_available()
reader_en = easyocr.Reader(['en'], gpu=use_gpu)
reader_ko = easyocr.Reader(['ko', 'en'], gpu=use_gpu)
print(f"EasyOCR Models loaded successfully! Ready using GPU: {use_gpu}")

paddle_reader_en = None
paddle_reader_ko = None
if HAS_PADDLEOCR:
    print("Loading PaddleOCR Models...")
    try:
        # Note: newer PaddleOCR uses lang='korean' for Korean
        paddle_reader_en = PaddleOCR(lang='en')
        paddle_reader_ko = PaddleOCR(lang='korean')
        print("PaddleOCR Models loaded successfully!")
    except Exception as e:
        print("Failed to initialize PaddleOCR on startup:", e)


class MangaRequest(BaseModel):
    image_base64: str
    source_lang: str = "en"
    translation_model: str = "gemini"

class LimitedCache(OrderedDict):
    def __init__(self, maxsize=100, *args, **kwargs):
        self.maxsize = maxsize
        super().__init__(*args, **kwargs)

    def __getitem__(self, key):
        value = super().__getitem__(key)
        self.move_to_end(key)
        return value

    def get(self, key, default=None):
        if key in self:
            return self[key]
        return default

    def __setitem__(self, key, value):
        if key in self:
            self.move_to_end(key)
        super().__setitem__(key, value)
        if len(self) > self.maxsize:
            self.popitem(last=False)

translation_cache = LimitedCache(maxsize=100)
text_translation_cache = LimitedCache(maxsize=1000)

# รายชื่อคำภาษาอังกฤษพื้นฐานและคำอุทานในมังงะที่พบได้บ่อยมาก
COMMON_ENGLISH_WORDS = {
    "i", "me", "my", "you", "your", "he", "him", "his", "she", "her", "it", "its", "we", "us", "our", "they", "them", "their",
    "am", "is", "are", "was", "were", "be", "been", "have", "has", "had", "do", "does", "did", "can", "could", "will", "would",
    "the", "a", "an", "and", "but", "or", "if", "so", "as", "of", "at", "by", "for", "with", "to", "from", "in", "out", "on", "up", "down",
    "what", "who", "where", "when", "why", "how", "this", "that", "these", "those", "here", "there",
    "no", "not", "yes", "yeah", "ok", "okay", "oh", "ah", "eh", "uh", "um", "ha", "huh", "hm", "hey", "hi", "hello", "wow", "sigh",
    "gasp", "pant", "grunt", "whoa", "please", "sorry", "thanks", "like", "go", "get", "make", "see", "look", "think", "know",
    "cannot", "anyone", "someone", "everyone", "anything", "something", "everything", "anywhere", "somewhere", "everywhere",
    "nobody", "nothing", "nowhere"
}

# ⚡ [ระบบคลังคำศัพท์ออฟไลน์ - English Frequency Dictionary Loader]
WORDS_FREQ = {}
dict_path = os.path.join(os.path.dirname(__file__), "english_words.txt")
if os.path.exists(dict_path):
    try:
        with open(dict_path, "r", encoding="utf-8") as f:
            for idx, line in enumerate(f):
                word = line.strip().lower()
                if word:
                    WORDS_FREQ[word] = 10000 - idx
    except Exception as e:
        print("Error loading english_words.txt:", e)

# ⚡ [ระบบคลังคำศัพท์ออฟไลน์ขนาดใหญ่เพิ่มเติมเพื่อความครอบคลุม]
large_dict_path = os.path.join(os.path.dirname(__file__), "english_words_large.txt")
if os.path.exists(large_dict_path):
    try:
        print("Loading english_words_large.txt...")
        with open(large_dict_path, "r", encoding="utf-8") as f:
            for line in f:
                word = line.strip().lower()
                if word and word not in WORDS_FREQ:
                    WORDS_FREQ[word] = 10
        print(f"Loaded comprehensive English dictionary. Total vocabulary: {len(WORDS_FREQ)} words.")
    except Exception as e:
        print("Error loading english_words_large.txt:", e)

# รายชื่อคำย่อ (Contractions)
CONTRACTION_MAP = {
    "isnt": "isn't", "arent": "aren't", "wasnt": "wasn't", "werent": "weren't",
    "dont": "don't", "doesnt": "doesn't", "didnt": "didn't", "cant": "can't",
    "couldnt": "couldn't", "wont": "won't", "wouldnt": "wouldn't", "shouldnt": "shouldn't",
    "havent": "haven't", "hasnt": "hasn't", "hadnt": "hadn't",
    "im": "i'm", "youre": "you're", "hes": "he's", "shes": "she's",
    "theyre": "they're", "ive": "i've", "youve": "you've", "weve": "we've",
    "theyve": "they've", "youll": "you'll", "theyll": "they'll",
    "youd": "you'd", "hed": "he'd", "theyd": "they'd"
}
for k, v in CONTRACTION_MAP.items():
    WORDS_FREQ[k] = 9800
    WORDS_FREQ[v] = 9800

SWEAR_AND_EXCLAMATIONS = [
    "fuck", "shit", "bitch", "ass", "damn", "bastard", "crap", "suck", "sucks",
    "dick", "pussy", "jerk", "wtf", "lmao", "omg", "hell", "gosh"
]
for word in SWEAR_AND_EXCLAMATIONS:
    WORDS_FREQ[word] = 9500

for word in COMMON_ENGLISH_WORDS:
    if word not in WORDS_FREQ:
        WORDS_FREQ[word] = 9900

COMMON_LL_ENDINGS = {
    "all", "will", "well", "bell", "cell", "dell", "fell",
    "hell", "jell", "sell", "tell", "yell", "bill", "fill",
    "gill", "hill", "kill", "mill", "pill", "sill", "till",
    "bull", "full", "gull", "hull", "lull", "mull", "null",
    "pull", "skull", "shall", "still", "spill", "skill",
    "small", "smell", "spell", "stall", "shell", "scroll"
}

SPELL_PROTECTED = set()

def build_protected_words():
    global SPELL_PROTECTED
    SPELL_PROTECTED = set(WORDS_FREQ.keys())
    
    extra = {
        "cannot", "anyone", "someone", "everyone",
        "anything", "something", "everything", "nowhere",
        "however", "therefore", "although", "throughout"
    }
    SPELL_PROTECTED.update(extra)
    
    for w in extra:
        if w not in WORDS_FREQ:
            WORDS_FREQ[w] = 9000

build_protected_words()

CREDIT_ROLES_WORDS = [
    "typesetter", "typesetting", "typeset", "translator", "cleaner", "proofreader",
    "scanlation", "scanlations", "raws", "sfx", "redrawer", "redraw", "author", "artist",
    "present", "presents"
]
COMIC_WORDS = [
    "bah", "arrogant", "newcomer", "newcomers", "teleplay", "yang", "zhang", "xuan", "invite", "ms", "mr", "mrs", "qin",
    "singing", "guest", "handsome", "opportunity", "refused", "before", "drag", "certain", "relying", "friend", "really", "right",
    "bind", "binds", "crush", "wow", "gasp", "whoa", "sigh", "pant", "grunt", "master", "sister", "brother",
    "senior", "junior", "elder", "young", "old", "sect", "clan", "realm", "stage", "peak", "core", "spirit",
    "qi", "dao", "lin", "zhang", "wang", "li", "chen", "yang", "liu", "zhao",
    "cultivate", "cultivation", "cultivator", "cultivators", "cultivating",
    "dantian", "alchemy", "talisman", "talismans", "pill", "pills", "beast", "beasts",
    "immortal", "immortality", "martial", "sovereign", "emperor", "ancestor", "patriarch",
    "disciple", "disciples"
]
for idx, word in enumerate(CREDIT_ROLES_WORDS):
    WORDS_FREQ[word] = 12000 - idx

for idx, word in enumerate(COMIC_WORDS):
    WORDS_FREQ[word] = 5000 - idx

# ตารางความสับสนของตัวอักษรยอดนิยมจากระบบ EasyOCR
OCR_CONFUSIONS = {
    'p': ['r'], 'P': ['R'],
    '4': ['u', 'h'],
    'L': ['u', 'i', 'o'], 'l': ['u', 'i', 'o'],
    '1': ['i', 'l'],
    '|': ['i', 'l', 't'],
    '0': ['o'],
    '8': ['b'],
    '5': ['s'],
    '6': ['g']
}


# Whitelist of valid short English words for Viterbi Word Segmenter
VALID_1_LETTER = {'a', 'i'}
VALID_2_LETTER = {
    'am', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it', 
    'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we', 'ok', 'oh', 
    'ah', 'ha', 'ur', 'yo', 'mr', 'ms', 'hi', 'by', 're', 've', 'll'
}
VALID_3_LETTER = {
    'the', 'and', 'but', 'for', 'you', 'not', 'are', 'was', 'had', 'has', 'him', 
    'her', 'its', 'our', 'out', 'one', 'all', 'any', 'who', 'how', 'why', 'can', 
    'did', 'get', 'see', 'run', 'say', 'use', 'old', 'day', 'way', 'boy', 'man', 
    'bad', 'sad', 'yes', 'yea', 'yep', 'now', 'new', 'few', 'too', 'own', 'off', 
    'let', 'big', 'low', 'sir', 'mom', 'dad', 'bro', 'sis', 'hey', 'wow', 'bye', 
    'die', 'god', 'son', 'sun', 'war', 'kid', 'guy', 'hug', 'cry', 'try', 'fly', 
    'buy', 'pay', 'win', 'eat', 'tea', 'ice', 'hot', 'red', 'age', 'ago', 'air',
    'art', 'bag', 'bar', 'bed', 'box', 'cap', 'car', 'cat', 'cop', 'cup', 'cut',
    'dog', 'dry', 'end', 'eye', 'fan', 'far', 'fit', 'fix', 'fun', 'gas', 'gem',
    'gun', 'hit', 'ill', 'ink', 'job', 'key', 'law', 'lay', 'leg', 'lid', 'lip',
    'log', 'mad', 'map', 'mix', 'mud', 'net', 'oil', 'pan', 'pen', 'pet', 'pig',
    'pin', 'pot', 'raw', 'row', 'rub', 'sad', 'sea', 'set', 'sex', 'sky', 'tap',
    'tax', 'tie', 'tin', 'tip', 'toe', 'ton', 'toy', 'wet', 'why', 'wig', 'wet'
}

import math

def segment_english_word(s):
    n = len(s)
    dp = [(-9999999.0, 0)] * (n + 1)
    dp[0] = (0.0, 0)
    
    C = 8.0
    
    for i in range(1, n + 1):
        for j in range(max(0, i - 20), i):
            word = s[j:i]
            w_lower = word.lower()
            
            is_valid = w_lower in WORDS_FREQ
            
            if len(word) == 1 and w_lower not in VALID_1_LETTER:
                is_valid = False
            elif len(word) == 2 and w_lower not in VALID_2_LETTER:
                is_valid = False
            elif len(word) == 3 and w_lower not in VALID_3_LETTER:
                is_valid = False
                
            if is_valid:
                freq = WORDS_FREQ[w_lower]
                score = math.log(freq) - C
                if len(word) == 1:
                    score -= 2.0
            else:
                score = -30.0 - (len(word) * 1.5)
            
            new_score = dp[j][0] + score
            if new_score > dp[i][0]:
                dp[i] = (new_score, j)
                
    result = []
    curr = n
    while curr > 0:
        prev = dp[curr][1]
        result.append(s[prev:curr])
        curr = prev
    result.reverse()
    return result

def segment_merged_words(text):
    if not text:
        return text
    tokens = re.split(r'([^a-zA-Z]+)', text)
    segmented_tokens = []
    for t in tokens:
        if re.match(r'^[a-zA-Z]+$', t):
            # Protect known manga names (case-insensitive) from being segmented
            known_manga_names = {"hinako", "itsuki", "tennoji", "shizune", "karen", "mirei", "konohana", "ojou", "samas", "sama", "san"}
            if t.lower() in known_manga_names or any(name in t.lower() for name in known_manga_names):
                segmented_tokens.append(t)
                continue

            if len(t) >= 7 and t.lower() not in WORDS_FREQ:
                segmented = segment_english_word(t)
                single_letter_count = sum(1 for w in segmented if len(w) == 1 and w.lower() not in {'a', 'i'})
                if (t.isupper() or t.istitle()) and single_letter_count > 0:
                    segmented_tokens.append(t)
                else:
                    segmented_tokens.append(" ".join(segmented))
            else:
                segmented_tokens.append(t)
        else:
            segmented_tokens.append(t)
    return "".join(segmented_tokens)


def is_valid_word(word):
    return word.lower() in WORDS_FREQ


def get_ocr_candidates(word):
    """สร้างคำแนะนำทางเลือกโดยอิงตามรูปแบบตัวอักษรที่ EasyOCR มักสับสน"""
    candidates = set()
    def replace_chars(s, i, current):
        if i == len(s):
            w = "".join(current)
            if is_valid_word(w):
                candidates.add(w)
            return
        char = s[i]
        replace_chars(s, i + 1, current + [char])
        if char in OCR_CONFUSIONS:
            for alt in OCR_CONFUSIONS[char]:
                replace_chars(s, i + 1, current + [alt])
        elif char.lower() in OCR_CONFUSIONS:
            for alt in OCR_CONFUSIONS[char.lower()]:
                alt_case = alt.upper() if char.isupper() else alt.lower()
                replace_chars(s, i + 1, current + [alt_case])
    replace_chars(word, 0, [])
    return candidates


def edits1(word):
    """คำนวณการแก้ไขคำที่ห่างกัน 1 อักขระ"""
    letters    = 'abcdefghijklmnopqrstuvwxyz'
    splits     = [(word[:i], word[i:])    for i in range(len(word) + 1)]
    deletes    = [L + R[1:]               for L, R in splits if R]
    transposes = [L + R[1] + R[0] + R[2:] for L, R in splits if len(R)>1]
    replaces   = [L + c + R[1:]           for L, R in splits if R for c in letters]
    inserts    = [L + c + R               for L, R in splits for c in letters]
    return set(deletes + transposes + replaces + inserts)


def get_edit_candidates(word):
    word_lower = word.lower()
    e1 = edits1(word_lower)
    candidates = set(w for w in e1 if w in WORDS_FREQ)
    return candidates


def correct_word(word):
    """แก้ไขคำสะกดผิดเป็นตัวอักษรเดียวโดยอิงจากความถี่พจนานุกรมและการจัดกลุ่ม OCR"""
    if not re.match(r'^[a-zA-Z0-9\'-]+$', word):
        return word
    word_lower = word.lower()
    # ⚡ Whitelist-first: ถ้าเป็นคำที่ระบบรู้จักและถูกต้องอยู่แล้ว ไม่ต้องไปดัดแปลงเลย
    if word_lower in SPELL_PROTECTED:
        return word
        
    if word_lower in CONTRACTION_MAP:
        return match_case(word, CONTRACTION_MAP[word_lower])
    if is_valid_word(word_lower):
        if len(word_lower) > 2 or word_lower in ["i", "me", "my", "we", "us", "he", "it", "so", "to", "go", "do", "no", "on", "in", "at", "by", "if", "or", "as", "am", "is", "be", "an", "ah", "oh"]:
            return word
            
    ocr_candidates = get_ocr_candidates(word)
    if ocr_candidates:
        best = max(ocr_candidates, key=lambda w: WORDS_FREQ.get(w.lower(), 0))
        if WORDS_FREQ.get(best.lower(), 0) >= 100:
            best_lower = best.lower()
            if best_lower in CONTRACTION_MAP:
                best = CONTRACTION_MAP[best_lower]
            return match_case(word, best)
            
    edit_candidates = get_edit_candidates(word)
    if edit_candidates:
        best = max(edit_candidates, key=lambda w: WORDS_FREQ.get(w.lower(), 0))
        if WORDS_FREQ.get(best.lower(), 0) >= 100:
            best_lower = best.lower()
            if best_lower in CONTRACTION_MAP:
                best = CONTRACTION_MAP[best_lower]
            return match_case(word, best)
            
    return word


def match_case(original, corrected):
    """จัดลำดับพิมพ์เล็ก/ใหญ่ให้สอดคล้องกับคำดิบต้นฉบับ"""
    if original.isupper():
        return corrected.upper()
    if original[0].isupper():
        return corrected[0].upper() + corrected[1:].lower()
    return corrected.lower()


def correct_sentence(sentence):
    """แก้ไขคำเพี้ยนอัจฉริยะสำหรับประโยคทั้งหมด"""
    tokens = re.split(r'([^a-zA-Z0-9\'-]+)', sentence)
    corrected_tokens = []
    for t in tokens:
        if re.match(r'^[a-zA-Z0-9\'-]+$', t):
            corrected_tokens.append(correct_word(t))
        else:
            corrected_tokens.append(t)
    return "".join(corrected_tokens)


def is_probable_english_word(word):
    word_lower = word.lower()
    if word_lower in WORDS_FREQ:
        return True
    if len(word_lower) <= 2:
        return word_lower in COMMON_ENGLISH_WORDS
    has_vowel = any(char in "aeiouy" for char in word_lower)
    if not has_vowel:
        return False
    clean_w = word_lower.replace('1', 'i').replace('0', 'o').replace('5', 's').replace('6', 'g').replace('8', 'b')
    if not clean_w.isalpha():
        return False
    return True


def fix_exclamation_marks(txt):
    """แก้ !!! เพี้ยน แต่ปกป้องคำที่ลงท้าย ll จริงๆ"""
    def replace_exclaim(m):
        full = m.group(0)
        # 1. ถ้าคำเต็มเป็นคำจริงอยู่แล้ว (เช่น will, all, shell) -> ไม่ต้องแตะเลย
        # ยกเว้นคำที่เป็นตัวพิมพ์เพี้ยนของ !!! ล้วนๆ เช่น III, lll, lI, ll
        is_exclaim_typo = re.match(r'^[il1]+$', full.lower()) is not None
        if (full.lower() in WORDS_FREQ or full.lower() in COMMON_LL_ENDINGS) and not is_exclaim_typo:
            return full
            
        # 2. ถ้าตัวท้ายเป็น ll แต่คำเหลือนำหน้าไม่ใช่คำจริง (เช่น wi + ll -> will เป็นคำจริง ถูกดักในข้อ 1 แล้ว)
        # แต่ถ้าเป็นคำจริงตัวอื่นพ่วง ll (เช่น whatll) หรือตัวท้ายเป็น lll/III/111/11 (ซึ่งไม่ใช่คำปกติแน่นอน)
        # ให้เปลี่ยนเฉพาะตัวพ่วงท้ายเป็น !!!
        match_end = re.search(r'(?:lll|III|111|11|ll)\b$', full)
        if match_end:
            prefix = full[:match_end.start()]
            suffix = match_end.group(0)
            
            if suffix in ["lll", "III", "111", "11"] or (suffix == "ll" and prefix.lower() in WORDS_FREQ):
                return prefix + "!!!"
                
        return full

    return re.sub(r'\b(?:[a-zA-Z]+(?:lll|III|111|11|ll)|lll|III|111|11)\b', replace_exclaim, txt)


def fix_ocr_typos(text):
    txt = text

    # 0. แก้ไขข้อความจำเพาะของตำแหน่งเครดิตและคำเฉพาะในมังงะ
    txt = re.sub(r'\btpesetier\b', 'TYPESETTER', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\btpesetter\b', 'TYPESETTER', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\btvpesetter\b', 'TYPESETTER', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\btvpesetier\b', 'TYPESETTER', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\btypesetier\b', 'TYPESETTER', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\btrnsletor\b', 'TRANSLATOR', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bclner\b', 'CLEANER', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bprofrader\b', 'PROOFREADER', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bproofreder\b', 'PROOFREADER', txt, flags=re.IGNORECASE)
    
    # แก้ไขคำประเภทการบำเพ็ญเพียร (Cultivation) ที่ EasyOCR มักตรวจจับเพี้ยน
    txt = re.sub(r'\bclltiate\b', 'cultivate', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bclltivate\b', 'cultivate', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bcult1vate\b', 'cultivate', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bcultlvate\b', 'cultivate', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bclltivation\b', 'cultivation', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bclltivator\b', 'cultivator', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bclltivators\b', 'cultivators', txt, flags=re.IGNORECASE)
    
    # แก้ไขข้อความจำเพาะของฟอนต์ตัวเอียง (Italic) ในคอมมิค/มังงะ
    txt = re.sub(r'\byoling\b', 'young', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bounc\b', 'our', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\btechniqlie\b', 'technique', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bletis\b', "let's", txt, flags=re.IGNORECASE)
    txt = re.sub(r"That'\s*[\$s]\b", "That's", txt, flags=re.IGNORECASE)
    txt = re.sub(r"that'\s*[\$s]\b", "that's", txt, flags=re.IGNORECASE)
    txt = re.sub(r'\b(aee|are)\s+(yol|you)\b', 'are you', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\b(bxeloeine|bxloine|bxloin|bxeloein)\b', 'exploring', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\b(duneeon|dungeon)\b', 'dungeon', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\b(someihig|someihing)\b', 'something', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bduo\s+you\b', 'did you', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\buhma\b', 'UHM', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bsholldnt\b', "shouldn't", txt, flags=re.IGNORECASE)
    txt = re.sub(r'\blone\b', 'long', txt, flags=re.IGNORECASE)
    txt = re.sub(r'[\$~]+', '', txt)
    txt = re.sub(r'\b4\b', 'a', txt)

    # Dictionary corrections for specific manga character names and OCR typos
    manga_ocr_corrections = {
        r'\btennolji\b': 'Tennoji',
        r'\btenno\s+l\s+i\b': 'Tennoji',
        r'\btennolji\s+san\b': 'Tennoji-san',
        r'\btenno\s+l\s+i\s+san\b': 'Tennoji-san',
        r'\bojou[- ]samal\b': 'Ojou-sama',
        r'\bojol\s+samas\b': 'Ojou-sama',
        r'\bojou\s+same\b': 'Ojou-sama',
        r'\bojou\s+sama\b': 'Ojou-sama',
        r'\bitslki\b': 'Itsuki',
        r'\bitslki\'s\b': "Itsuki's",
        r'\bshizlne\b': 'Shizune',
        r'\bshizlne[- ]san\b': 'Shizune-san',
        r'\bkagen\s+same\b': 'Karen-sama',
        r'\bkagen\b': 'Karen',
        r'\bhinako\'s\b': "Hinako's",
        r'\bihinako\b': 'Hinako',
        r'\bihm\b': 'UHM',
        r'\buh\s+i\s+hi\s+nako\b': 'UHM, Hinako',
        r'\buh\s+ihinako\b': 'UHM, Hinako',
        r'\bigack\b': 'back',
        r'\bsae\b': 'same',
        r'\bthine\b': 'thing',
        r'\beertai\b': 'certainly',
        r'\bcpeasel\b': 'crease',
        r'\byoupi\b': 'your',
        r'\bforsaqe\b': 'for some',
        r'\bandi\b': 'and',
        r'\bsf\b': 'if',
        r'\baolnt\s+ceis\b': 'amount is',
        r'\bcltlery\b': 'cutlery',
        r'\binwapd\b': 'inward',
        r'\bimieht\b': 'I might',
        r'\banxiols\b': 'anxious',
        r'\bipefore\b': 'before',
        r'\bigefore\b': 'before',
        r'\bgeo\s+re\b': 'before',
        r'\bpidnti\b': "didn't",
        r'\boefinitelyl\b': 'definitely',
        r'\btakeei\b': 'take care',
        r'\btakei\b': 'take care',
        r'\bpeastless\b': 'restless',
        r'\bpestless\b': 'restless',
        r'\bpest\s+less\b': 'restless',
        r'\blrieht\b': 'alright',
        r'\balrieht\b': 'alright',
        r'\bricht\b': 'right',
        r'\bended\s+lp\b': 'ended up',
        r'\byoull\b': "you'll",
        r'\bcollo\b': 'could',
        r'\bsholdnt\b': "shouldn't",
        r'\btonolji\b': 'Tennoji',
        r'\btenoji\b': 'Tennoji',
    }
    for pattern, replacement in manga_ocr_corrections.items():
        txt = re.sub(pattern, replacement, txt, flags=re.IGNORECASE)

    # 1. ลบจุดไข่ปลาหรือสัญลักษณ์นำหน้า
    txt = re.sub(r'^[\s.,\-_~;:!?|\\/]+', '', txt)

    # 2. แก้ปัญหาตัวอักษรขยะนำหน้าคำภาษาอังกฤษทั่วไป
    target_common_words = [
        "IS", "HE", "IT", "YOU", "WANT", "CAN", "HAVE", "AM", "ARE", "WAS", "WERE",
        "DO", "DID", "NOT", "NO", "OK", "OKAY", "OH", "AH", "THE", "AND", "BUT",
        "OR", "IF", "SO", "AS", "OF", "AT", "BY", "FOR", "WITH", "TO", "FROM",
        "IN", "OUT", "ON", "UP", "DOWN", "WHAT", "WHO", "WHERE", "WHEN", "WHY",
        "HOW", "THIS", "THAT", "THESE", "THOSE", "HERE", "THERE", "REALLY", "NOISY"
    ]
    for cw in target_common_words:
        txt = re.sub(r'\b[l1\|i]' + cw + r'\b', cw, txt)
        cw_cap = cw.capitalize()
        txt = re.sub(r'\b[l1\|i]' + cw_cap + r'\b', cw_cap, txt)
        cw_lower = cw.lower()
        txt = re.sub(r'\b[l1\|i]' + cw_lower + r'\b', cw_lower, txt)

    # 2.5 แก้ idiom พิเศษก่อน spell checker จะทำลายมัน
    txt = re.sub(r'\bhave\s+a\s+crush\s+on\b', 'secretly like', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bhas\s+a\s+crush\s+on\b', 'secretly likes', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bhad\s+a\s+crush\s+on\b', 'secretly liked', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bcrush\s+on\b', 'secretly like', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bthe\s+one\s+you\s+secretly\s+like\b', 'the person you secretly like', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bthe\s+one\s+you\s+like\b', 'the person you secretly like', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bthe\s+one\s+you\s+have\s+a\s+crush\s+on\b', 'the person you secretly like', txt, flags=re.IGNORECASE)

    # 3. OCR-Aware Probabilistic Spell Checker
    txt = correct_sentence(txt)

    # แก้ไขปัญหา "went out" เพี้ยน
    txt = re.sub(r'\bwon\'t\s+out\b', 'went out', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bwont\s+out\b', 'went out', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bwent\s+@?ut\b', 'went out', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\bwent\s+@?out\b', 'went out', txt, flags=re.IGNORECASE)

    # แปลง comma ที่คั่นประโยคคำถาม
    txt = re.sub(r'\b(isn\'t|aren\'t|wasn\'t|weren\'t|don\'t|doesn\'t|didn\'t|can\'t|won\'t|wouldn\'t|shouldn\'t)\b([^?]*?),\s*(you|he|she|it|they|we|i)\b', r'\1\2? \3', txt, flags=re.IGNORECASE)

    # 4. แก้ปัญหาตัวอักษร I ใหญ่ในคำสั้น
    txt = re.sub(r'\b[l1\|i]S\b', 'IS', txt)
    txt = re.sub(r'\b[l1\|i]T\b', 'IT', txt)
    txt = re.sub(r'\b[l1\|i]N\b', 'IN', txt)
    txt = re.sub(r'\b[l1\|i]F\b', 'IF', txt)
    txt = re.sub(r'\b[l1\|i]s\b', 'is', txt)
    txt = re.sub(r'\b[l1\|i]t\b', 'it', txt)
    txt = re.sub(r'\b[l1\|i]n\b', 'in', txt)
    txt = re.sub(r'\b[l1\|i]f\b', 'if', txt)

    # แก้เครื่องหมายวรรคตอนท้ายประโยค
    txt = re.sub(r'(?<=[a-zA-Z!?])\s*(?:14|i4|l4)\b$', '!?', txt)
    txt = re.sub(r'(?<=[a-zA-Z!?])\s*(?:11|i1|l1)\b$', '!!', txt)

    # ลบสัญลักษณ์ขยะท้ายประโยค
    txt = re.sub(r'[\s:|\\/\-;,._~]+$', '', txt)

    # แก้ตัวเลข 6 สับสนเป็น G
    txt = re.sub(r'\b([a-zA-Z]+)6\b', lambda m: m.group(1) + ('G' if m.group(1)[-1].isupper() else 'g'), txt)

    # เติมจุดสิ้นสุดประโยค
    txt = re.sub(r'\b(door|room|class|next door)\s+(the\s+one)\b', r'\1. \2', txt, flags=re.IGNORECASE)
    txt = re.sub(r'\b(door|room|class|next door):\s+(the\s+one)\b', r'\1. \2', txt, flags=re.IGNORECASE)

    # crush on (backup pass หลัง spell checker ด้วย - double safety)
    txt = re.sub(r'\bcrush\s+on\b', 'secretly like', txt, flags=re.IGNORECASE)

    # แก้ !!! เพี้ยนเป็น lll (ลบ ll ออกเพื่อไม่ให้กระทบคำปกติ เช่น all, will)
    txt = fix_exclamation_marks(txt)

    # แก้ขีดล่าง
    txt = txt.replace('_', ' ')

    # เคลียร์คำพิมพ์เล็กใหญ่ผสมกันมั่ว
    words = txt.split()
    fixed_words = []
    for w in words:
        match = re.match(r'^([^a-zA-Z0-9]*)(.*?)([^a-zA-Z0-9]*)$', w)
        if match:
            prefix, core_word, suffix = match.groups()
            if any(c.isupper() for c in core_word) and any(c.islower() for c in core_word):
                if not (core_word[0].isupper() and all(c.islower() for c in core_word[1:])):
                    core_word = core_word.lower()
            fixed_words.append(prefix + core_word + suffix)
        else:
            fixed_words.append(w)
    txt = " ".join(fixed_words)

    txt = re.sub(r'\s+', ' ', txt)
    return txt.strip()


def is_valid_text_box(text, source_lang="en"):
    txt = text.strip()
    if source_lang == "ko":
        if re.search(r'[\uac00-\ud7a3]', txt):
            return True
    txt = txt.replace('|', 'I')
    if any(credit in txt.upper() for credit in ["CLIRD", "CHAPTER", "SCAN", "DISCORD", "PAGE", "VOLUME"]):
        return False
    if re.match(r'^[a-zA-Z0-9]\s+[a-zA-Z0-9]$', txt):
        return False
    words = re.findall(r'\b[a-zA-Z0-9]+\b', txt)
    if not words:
        return False
    # Always allow numbers and proper names/capitalized words
    if any(w.isdigit() for w in words):
        return True
    if len(words) == 1 and (words[0].isupper() or words[0].istitle()):
        return True
    valid_word_count = sum(1 for w in words if is_probable_english_word(w))
    english_ratio = valid_word_count / len(words)
    if len(words) <= 2 and valid_word_count == 0:
        return False
    if english_ratio < 0.35:
        return False
    return True


def clean_text(text, source_lang="en"):
    txt = text.strip()
    if source_lang == "ko":
        if re.search(r'[\uac00-\ud7a3]', txt):
            txt = re.sub(r'^[\s.,\-_~;:!?|\\/]+', '', txt)
            txt = re.sub(r'[\s:|\\/\-;,._~!?]+$', '', txt)
            txt = re.sub(r'\s+', ' ', txt)
            return txt.strip()
    txt = txt.replace('|', 'I')
    if source_lang == "en":
        txt = segment_merged_words(txt)
    txt = fix_ocr_typos(txt)
    if not txt:
        return ""
    if any(credit in txt.upper() for credit in ["CLIRD", "CHAPTER", "SCAN", "DISCORD", "PAGE", "VOLUME"]):
        return ""
    words = re.findall(r'\b[a-zA-Z0-9]+\b', txt)
    if not words:
        return ""
    # Always preserve numbers and single proper names/SFX
    if any(w.isdigit() for w in words):
        return txt
    if len(words) == 1 and (words[0].isupper() or words[0].istitle()):
        return txt
    valid_word_count = sum(1 for w in words if is_probable_english_word(w))
    english_ratio = valid_word_count / len(words)
    if len(words) <= 2 and valid_word_count == 0:
        return ""
    if english_ratio < 0.35:
        return ""
    return txt


def refine_thai_translation(text):
    if not text:
        return text
    t = text

    # 1. แก้ไขคำผิดสะกดสระ/วรรณยุกต์เพี้ยน
    t = re.sub(r'พีชาย', 'พี่ชาย', t)
    t = re.sub(r'นองชาย', 'น้องชาย', t)
    t = re.sub(r'พีสาว', 'พี่สาว', t)
    t = re.sub(r'นองสาว', 'น้องสาว', t)
    t = re.sub(r'พีสะใภ้', 'พี่สะใภ้', t)
    t = re.sub(r'พีเขย', 'พี่เขย', t)
    t = re.sub(r'พีน้อง', 'พี่น้อง', t)
    t = re.sub(r'เพือน', 'เพื่อน', t)
    t = re.sub(r'เจา(นาย|ของ|ตัว|ปัญหา|หญิง|ชาย|พ่อ|แม่|บ่าว|เล่ห์|ถิ่น|หน้าที่|ชู้)', r'เจ้า\1', t)
    t = re.sub(r'ชวย', 'ช่วย', t)
    t = re.sub(r'ดวย', 'ด้วย', t)

    t = re.sub(r'(?<![\u0e00-\u0e7f])แต(?![\u0e00-\u0e7f])', 'แต่', t)
    t = re.sub(r'แต(ว่า|ผม|ฉัน|เขา|เธอ|มัน|เรา|คุณ|นาย|พวก|ก็|นะ|จะ|ไม่|มี|เป็น|ได้|ต้อง|ถ้า|ใน|ที่|ละ)', r'แต่\1', t)

    t = re.sub(r'(?<![\u0e00-\u0e7f])ไม(?![\u0e00-\u0e7f])', 'ไม่', t)
    t = re.sub(r'(?<![\u0e00-\u0e7f])ไม(ได้|มี|ใช่|เป็น|ต้อง|อยาก|เห็น|รู้|เข้า|เคย|ชอบ|จริง|สามารถ|ยอม|ยอมรับ|คิด|พูด|ทำ)', r'ไม่\1', t)

    t = re.sub(r'(?<![\u0e00-\u0e7f])ได(?![\u0e00-\u0e7f])', 'ได้', t)
    t = re.sub(r'ไม่ได(?!้)', 'ไม่ได้', t)
    t = re.sub(r'ทำไม่ได(?!้)', 'ทำไม่ได้', t)
    t = re.sub(r'จะได(?!้)', 'จะได้', t)
    t = re.sub(r'(?<![\u0e00-\u0e7f])ได(อย่างไร|ไง|รับ|ดี|ยิน|กิน|กลิ่น|พบ|ตัว|ใจ|สติ|รับการ|รับอนุญาต)', r'ได้\1', t)

    t = re.sub(r'แลว(?!้)', 'แล้ว', t)
    t = re.sub(r'อยาง(?!่)', 'อย่าง', t)
    t = re.sub(r'อยาง(ไร|ก็ตาม|ดี|น้อย|มาก|ยิ่ง)', r'อย่าง\1', t)
    t = re.sub(r'จรง(ๆ|\s+ๆ)', 'จริงๆ', t)

    # 2. ปรับสำนวนแปลแข็ง -> Natural Manga Style
    t = re.sub(r'ทำลาย(พันธะ|กฎ|ขีดจำกัด)?แรงโน้มถ่วง', 'ฝ่าฝืนแรงโน้มถ่วง', t)
    t = re.sub(r'ทำลายกฎ', 'ฝ่าฝืนกฎ', t)
    t = re.sub(r'ทำลายสัญญา', 'ผิดสัญญา', t)
    t = re.sub(r'ทำลายหัวใจ', 'ทำร้ายจิตใจ', t)
    t = re.sub(r'ละเมิดแรงโน้มถ่วง', 'ฝ่าฝืนแรงโน้มถ่วง', t)
    t = re.sub(r'หลีกหนีแรงโน้มถ่วง', 'ต้านแรงโน้มถ่วง', t)
    t = re.sub(r'พันธะแรงโน้มถ่วง', 'แรงโน้มถ่วง', t)

    t = re.sub(r'ฉันชื่อ\s*(ms\s+)?memory\s*ไม่ผิด', 'ถ้าความจำฉันไม่ผิดพลาด', t, flags=re.IGNORECASE)
    t = re.sub(r'ฉันชื่อ\s*ความทรงจำ\s*ไม่ผิด', 'ถ้าความจำฉันไม่ผิดพลาด', t)
    t = re.sub(r'(หาก|ถ้า)ความทรงจำ(ของฉัน|ของผม)?ไม่ผิด', 'ถ้าความจำฉันไม่ผิดพลาด', t)

    t = re.sub(r'ไปยังยมโลก', 'ลงนรก', t)
    t = re.sub(r'ด้วยมือของ(เธอ|เขา|ฉัน)เอง', 'ด้วยมือของตัวเอง', t)

    t = re.sub(r'รูปลักษณ์ของ(หญิงชรา|ชายชรา|เด็ก|ผู้หญิง|ผู้ชาย|คนนี้|คนนั้น|เธอ|เขา)', r'การปรากฏตัวของ\1', t)

    t = re.sub(
        r'(ก็)?(ไม่)?\s*(รู้สึก)?\s*(แปลกไป|ผิดปกติ|ไม่ปกติ|ไม่เข้ากัน|ไม่เหมาะ|เข้ากับสถานที่)\s*(เลยเหรอ|ใช่ไหม)',
        r'ดูไม่เข้ากับสถานการณ์\5',
        t
    )

    t = re.sub(
        r'(\s*)(ที่นี่|ทีนี)?\s*(จะต้อง|คงจะมี|คงมี|คง|มันต้อง)?\s*มีคน\s*(อยู่)?\s*(ที่นี่|ทีนี)?\s*(เพื่อพบ|มาพบ|มาพบกับ|พบกับ|พบ)\s*(เธอ|เขา)(?:\s*แน่ๆ)?',
        r'\1ต้องมีใครสักคนมารับ\7ที่นี่แน่',
        t
    )
    t = re.sub(r'(พวกเขา)?ต้องเป็นคนที่มาพบเพื่อพบ(เขา|เธอ)', r'ต้องมีใครสักคนมารับ\2ที่นี่แน่', t)
    t = re.sub(r'(ซุ่มโจมตี|ดักรอ)(ที่|ใน|ที)ลิฟต์(หรือไม่|ไหม|มั้ย|\s*ดี\s*ไหม|\s*ดี\s*มั้ย)?', r'ดักรอที่ลิฟต์ดีไหม', t)

    # 3. Manga Dialogue Polish
    t = re.sub(r'พี่ชาย([\s,;:\-]*)(ฉัน|ข้า)(?![\u0e00-\u0e7f])', r'พี่ชาย\1ผม', t)
    t = re.sub(r'พี่สาว([\s,;:\-]*)(ฉัน|ข้า)(?![\u0e00-\u0e7f])', r'พี่สาว\1ผม', t)
    t = re.sub(r'คุณพี่([\s,;:\-]*)(ฉัน|ข้า)(?![\u0e00-\u0e7f])', r'คุณพี่\1ผม', t)

    t = re.sub(
        r'พี่ชาย([\s,;:\-]*)(ฉัน|ข้า|ผม)?([\s,;:\-]*)(ไม่ได้|ไม่)?([\s,;:\-]*)ฝ่าฝืนแรงโน้มถ่วง',
        r'พี่ชาย ผมไม่ได้ฝ่าฝืนแรงโน้มถ่วง',
        t
    )
    t = re.sub(
        r'พี่สาว([\s,;:\-]*)(ฉัน|ข้า|ผม)?([\s,;:\-]*)(ไม่ได้|ไม่)?([\s,;:\-]*)ฝ่าฝืนแรงโน้มถ่วง',
        r'พี่สาว ผมไม่ได้ฝ่าฝืนแรงโน้มถ่วง',
        t
    )

    # 4. ปรับเปลี่ยนหางเสียง
    t = re.sub(r'จริงๆ\s*([!！？]?)$', r'จริงๆ นะ\1', t)
    t = re.sub(r'จริงๆนะ\s*([!！？]?)$', r'จริงๆ นะ\1', t)
    t = re.sub(r'จริง\s+ๆ\s*([!！？]?)$', r'จริงๆ นะ\1', t)

    # ลบเครื่องหมายเซมิโคลน/โคลนส่วนเกินหัวประโยค
    t = re.sub(r'^(พี่ชาย|พี่สาว|น้องชาย|น้องสาว|คุณพี่)([\s,;:\-]+)', r'\1 ', t)

    # เพิ่มความลื่นไหลสำหรับประโยคลบความทรงจำ
    t = re.sub(r'และ?\s*แม้กระทั่งลบความทรงจำ', 'และยังลบความทรงจำ', t)
    t = re.sub(r'ลบความทรงจำของเขา$', 'ลบความทรงจำของเขาอีกด้วย...', t)

    # 5. แปลง semicolon ที่ไม่ใช่ตัวเลข → comma
    t = re.sub(r'(?<!\d);|;(?!\d)', ',', t)

    return t


def translate_real(text, source_lang="en"):
    cleaned_text = clean_text(text, source_lang)
    if not cleaned_text:
        return ""
    cache_key = (source_lang, cleaned_text.strip())
    if cache_key in text_translation_cache:
        return text_translation_cache[cache_key]
    try:
        translated = GoogleTranslator(source=source_lang, target='th').translate(cleaned_text)
        result = refine_thai_translation(translated)
        text_translation_cache[cache_key] = result
        return result
    except Exception as e:
        return cleaned_text


def split_thai_graphemes(text):
    graphemes = []
    current = ""
    for char in text:
        if char in '\u0e31\u0e34\u0e35\u0e36\u0e37\u0e38\u0e39\u0e3a\u0e47\u0e48\u0e49\u0e4a\u0e4b\u0e4c\u0e4d\u0e4e':
            current += char
        else:
            if current:
                graphemes.append(current)
            current = char
    if current:
        graphemes.append(current)
    return graphemes


def wrap_thai_text(text, font, max_width):
    if "\n" in text:
        all_lines = []
        for part in text.split("\n"):
            all_lines.extend(wrap_thai_text(part, font, max_width))
        return all_lines

    if HAS_PYTHAINLP:
        words = word_tokenize(text)
    else:
        words = split_thai_graphemes(text)

    lines = []
    current_line = []

    for word in words:
        test_line = "".join(current_line + [word])
        bbox = font.getbbox(test_line)
        width = bbox[2] - bbox[0]

        if width <= max_width:
            current_line.append(word)
        else:
            if current_line:
                line_str = "".join(current_line)
                if line_str.strip():
                    lines.append(line_str)
                if word.strip() == "":
                    current_line = []
                else:
                    current_line = [word]
            else:
                graphemes = split_thai_graphemes(word)
                temp_line = []
                for g in graphemes:
                    test_g = "".join(temp_line + [g])
                    bbox_g = font.getbbox(test_g)
                    width_g = bbox_g[2] - bbox_g[0]
                    if width_g <= max_width:
                        temp_line.append(g)
                    else:
                        if temp_line:
                            lines.append("".join(temp_line))
                            temp_line = [g]
                        else:
                            lines.append(g)
                            temp_line = []
                current_line = temp_line

    if current_line:
        line_str = "".join(current_line)
        if line_str.strip():
            lines.append(line_str)

    return lines


def get_optimal_font_and_lines(text, box_width, box_height):
    font_path = THAI_FONT_PATH
    if not os.path.exists(font_path):
        font_names = ["Sarabun-Regular.ttf", "leelawad.ttf", "tahoma.ttf", "arial.ttf"]
        for name in font_names:
            try:
                ImageFont.truetype(name, 16)
                font_path = name
                break
            except IOError:
                continue

    max_font_size = max(16, int(box_height * 0.45))
    max_font_size = min(max_font_size, 38)

    best_font = None
    best_lines = []

    for font_size in range(max_font_size, 11, -1):
        try:
            font = ImageFont.truetype(font_path, font_size)
        except IOError:
            font = ImageFont.load_default()

        lines = wrap_thai_text(text, font, box_width)
        line_height = int(font_size * 1.25)
        total_height = len(lines) * line_height

        max_line_width = 0
        for line in lines:
            bbox = font.getbbox(line)
            max_line_width = max(max_line_width, bbox[2] - bbox[0])

        if total_height <= box_height and max_line_width <= box_width:
            best_font = font
            best_lines = lines
            break

    if not best_font:
        try:
            best_font = ImageFont.truetype(font_path, 12)
        except IOError:
            best_font = ImageFont.load_default()
        best_lines = wrap_thai_text(text, best_font, box_width)

    return best_font, best_lines


def rgb_to_hsv(r, g, b):
    r_f, g_f, b_f = r / 255.0, g / 255.0, b / 255.0
    mx = max(r_f, g_f, b_f)
    mn = min(r_f, g_f, b_f)
    df = mx - mn
    if mx == mn:
        h = 0
    elif mx == r_f:
        h = (60 * ((g_f - b_f) / df) + 360) % 360
    elif mx == g_f:
        h = (60 * ((b_f - r_f) / df) + 120) % 360
    else:
        h = (60 * ((r_f - g_f) / df) + 240) % 360
    s = 0 if mx == 0 else (df / mx)
    v = mx
    return h, s, v


def is_different_text_color(c1, c2):
    h1, s1, v1 = rgb_to_hsv(*c1)
    h2, s2, v2 = rgb_to_hsv(*c2)

    def get_color_category(h, s, v):
        if v < 0.15:
            return "neutral_dark"
        if s < 0.20:
            return "neutral_light"
        if h < 25 or h > 335:
            return "red"
        if 35 <= h <= 85:
            return "yellow"
        return "other"

    cat1 = get_color_category(h1, s1, v1)
    cat2 = get_color_category(h2, s2, v2)

    if cat1 != cat2:
        return True
    if "neutral" in cat1:
        dist = np.sqrt(sum((x - y)**2 for x, y in zip(c1, c2)))
        return dist > 55
    if cat1 == "red":
        hue_diff = abs(h1 - h2)
        if hue_diff > 180:
            hue_diff = 360 - hue_diff
        return hue_diff > 30
    if cat1 == "yellow":
        return abs(h1 - h2) > 20
    return False


def get_background_and_text_color(img, x_min, y_min, x_max, y_max):
    width, height = img.size

    x_start = max(0, x_min)
    x_end = min(width, x_max)
    y_start = max(0, y_min)
    y_end = min(height, y_max)

    if x_end <= x_start or y_end <= y_start:
        return (255, 255, 255), (0, 0, 0)

    box = img.crop((x_start, y_start, x_end, y_end))
    box_np = np.array(box)
    H, W, C = box_np.shape

    border_width = 2
    if H <= 2 * border_width or W <= 2 * border_width:
        median_color = np.median(box_np, axis=(0, 1))
        bg_color = (int(median_color[0]), int(median_color[1]), int(median_color[2]))
    else:
        border_mask = np.zeros((H, W), dtype=bool)
        border_mask[:border_width, :] = True
        border_mask[-border_width:, :] = True
        border_mask[:, :border_width] = True
        border_mask[:, -border_width:] = True

        border_pixels = box_np[border_mask]
        median_color = np.median(border_pixels, axis=0)
        bg_color = (int(median_color[0]), int(median_color[1]), int(median_color[2]))

    bg_r, bg_g, bg_b = bg_color

    diff_r = box_np[:, :, 0].astype(float) - bg_r
    diff_g = box_np[:, :, 1].astype(float) - bg_g
    diff_b = box_np[:, :, 2].astype(float) - bg_b
    dist = np.sqrt(diff_r**2 + diff_g**2 + diff_b**2)

    text_mask = dist > 12
    text_pixels = box_np[text_mask]

    if len(text_pixels) > 0:
        text_lums = 0.299 * text_pixels[:, 0] + 0.587 * text_pixels[:, 1] + 0.114 * text_pixels[:, 2]
        bg_lum = (0.299 * bg_r + 0.587 * bg_g + 0.114 * bg_b) / 255.0

        if bg_lum <= 0.5:
            bright_threshold = np.percentile(text_lums, 80)
            bright_pixels = text_pixels[text_lums >= bright_threshold]
            if len(bright_pixels) > 0:
                median_text = np.median(bright_pixels, axis=0)
            else:
                median_text = np.median(text_pixels, axis=0)
        else:
            dark_threshold = np.percentile(text_lums, 20)
            dark_pixels = text_pixels[text_lums <= dark_threshold]
            if len(dark_pixels) > 0:
                median_text = np.median(dark_pixels, axis=0)
            else:
                median_text = np.median(text_pixels, axis=0)

        text_color = (int(median_text[0]), int(median_text[1]), int(median_text[2]))
    else:
        bg_lum = (0.299 * bg_r + 0.587 * bg_g + 0.114 * bg_b) / 255.0
        text_color = (0, 0, 0) if bg_lum > 0.5 else (255, 255, 255)

    bg_lum = (0.299 * bg_r + 0.587 * bg_g + 0.114 * bg_b) / 255.0
    if bg_lum > 0.90:
        bg_color = (255, 255, 255)
        text_color = (0, 0, 0)

    return bg_color, text_color


def clean_text_in_box(img, x_min, y_min, x_max, y_max, bg_color):
    width, height = img.size
    x_min = max(0, x_min)
    y_min = max(0, y_min)
    x_max = min(width, x_max)
    y_max = min(height, y_max)

    if x_max <= x_min or y_max <= y_min:
        return

    bg_r, bg_g, bg_b = bg_color

    box = img.crop((x_min, y_min, x_max, y_max))
    box_np = np.array(box)
    h, w, c = box_np.shape

    diff_r = box_np[:, :, 0].astype(float) - bg_r
    diff_g = box_np[:, :, 1].astype(float) - bg_g
    diff_b = box_np[:, :, 2].astype(float) - bg_b
    dist = np.sqrt(diff_r**2 + diff_g**2 + diff_b**2)

    mask = dist > 20

    mask_pixels = np.sum(mask)
    total_pixels = mask.size

    if mask_pixels == 0:
        return

    # ขยาย Mask (Dilation) ด้วย OpenCV (เร็วและมีประสิทธิภาพกว่า)
    mask_uint8 = (mask * 255).astype(np.uint8)
    kernel = np.ones((3, 3), dtype=np.uint8)
    dilated_uint8 = cv2.dilate(mask_uint8, kernel, iterations=3)
    mask = dilated_uint8 > 0

    # Boundary Protection
    border_px = 3
    if h > 2 * border_px and w > 2 * border_px:
        mask[:border_px, :] = False
        mask[-border_px:, :] = False
        mask[:, :border_px] = False
        mask[:, -border_px:] = False

    bg_lum = (0.299 * bg_r + 0.587 * bg_g + 0.114 * bg_b) / 255.0
    mask_uint8 = (mask * 255).astype(np.uint8)

    if bg_lum > 0.88:
        cleaned_np = box_np.copy()
        cleaned_np[mask] = bg_color
    else:
        cleaned_np = cv2.inpaint(box_np, mask_uint8, inpaintRadius=3, flags=cv2.INPAINT_TELEA)

    cleaned_img = Image.fromarray(cleaned_np)
    img.paste(cleaned_img, (x_min, y_min))


def merge_layout_boxes(img, bounds, scale_x=1.0, scale_y=1.0, source_lang="en"):
    """⚡ Smart Speech Bubble Box Clustering & Merger"""
    raw_items = []
    for bound in bounds:
        points = bound[0]
        text = bound[1]
        confidence = bound[2] if len(bound) > 2 else 1.0

        fixed_text = fix_ocr_typos(text)
        is_credit_role = any(role in fixed_text.upper() for role in ["TRANSLATOR", "CLEANER", "TYPESETTER", "PROOFREADER"])

        words = re.findall(r'\b[a-zA-Z0-9]+\b', fixed_text)
        valid_word_count = sum(1 for w in words if is_probable_english_word(w))
        english_ratio = valid_word_count / len(words) if words else 0.0
        is_valid_sentence_en = len(words) >= 3 and english_ratio >= 0.75

        is_valid_sentence_ko = (source_lang == "ko" and
                                bool(re.search(r'[\uac00-\ud7a3]', fixed_text)) and
                                len(fixed_text.strip()) >= 2)

        has_any_valid_text = (valid_word_count >= 1 and english_ratio >= 0.50) or is_valid_sentence_ko

        min_conf = 0.15 if (is_credit_role or is_valid_sentence_en or has_any_valid_text) else 0.30

        if confidence < min_conf:
            continue

        if not is_valid_text_box(text, source_lang):
            continue

        x_min = int(min([p[0] for p in points]) * scale_x)
        y_min = int(min([p[1] for p in points]) * scale_y)
        x_max = int(max([p[0] for p in points]) * scale_x)
        y_max = int(max([p[1] for p in points]) * scale_y)

        text_clean = fixed_text.strip()
        text_clean = re.sub(r"That'\s*[\$s]\b", "That's", text_clean, flags=re.IGNORECASE)
        text_clean = re.sub(r"that'\s*[\$s]\b", "that's", text_clean, flags=re.IGNORECASE)
        text_clean = re.sub(r'[\$~]+', '', text_clean).strip()

        if not text_clean:
            continue

        raw_items.append({
            "x_min": x_min, "y_min": y_min,
            "x_max": x_max, "y_max": y_max,
            "text": text_clean,
            "conf": confidence
        })

    if not raw_items:
        return []

    # Helper function to test if 2 line boxes belong to the same speech bubble
    def is_same_bubble(b1, b2):
        y_gap = max(0, max(b1['y_min'], b2['y_min']) - min(b1['y_max'], b2['y_max']))
        h1 = b1['y_max'] - b1['y_min']
        h2 = b2['y_max'] - b2['y_min']
        avg_h = (h1 + h2) / 2

        # Lines inside the same speech bubble have tight line spacing (y_gap <= avg_h * 0.85)
        max_y_gap = max(18, min(30, int(avg_h * 0.85)))
        if y_gap > max_y_gap:
            return False

        x_overlap = min(b1['x_max'], b2['x_max']) - max(b1['x_min'], b2['x_min'])
        w1 = b1['x_max'] - b1['x_min']
        w2 = b2['x_max'] - b2['x_min']
        min_w = min(w1, w2)

        if x_overlap < -15:
            return False

        cx1 = (b1['x_min'] + b1['x_max']) / 2
        cx2 = (b2['x_min'] + b2['x_max']) / 2

        # Separate speech bubble lobes: if centers are shifted horizontally (> 40px) with small overlap (< 45px)
        if abs(cx1 - cx2) > 40 and x_overlap < 45:
            return False

        if abs(cx1 - cx2) > max(100, min_w * 0.75) and x_overlap < 10:
            return False

        return True

    n = len(raw_items)
    parent = list(range(n))
    def find(i):
        if parent[i] == i: return i
        parent[i] = find(parent[i])
        return parent[i]

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    for i in range(n):
        for j in range(i + 1, n):
            if is_same_bubble(raw_items[i], raw_items[j]):
                union(i, j)

    clusters = {}
    for i in range(n):
        root = find(i)
        if root not in clusters:
            clusters[root] = []
        clusters[root].append(raw_items[i])

    merged_boxes = []
    for root, bubble_lines in sorted(clusters.items(), key=lambda c: min(b['y_min'] for b in c[1])):
        bubble_lines.sort(key=lambda b: b['y_min'])

        merged_text = ""
        for line in bubble_lines:
            t = line['text']
            if merged_text.endswith("-"):
                merged_text = merged_text[:-1] + t
            elif merged_text:
                merged_text += " " + t
            else:
                merged_text = t

        x_min = min(b['x_min'] for b in bubble_lines)
        y_min = min(b['y_min'] for b in bubble_lines)
        x_max = max(b['x_max'] for b in bubble_lines)
        y_max = max(b['y_max'] for b in bubble_lines)

        merged_boxes.append({
            "x_min": x_min,
            "y_min": y_min,
            "x_max": x_max,
            "y_max": y_max,
            "text_eng": merged_text
        })

    return merged_boxes


def preprocess_for_ocr(img_ocr):
    """Binarization แบบ Adaptive"""
    img_np = np.array(img_ocr.convert("L"))
    binary = cv2.adaptiveThreshold(
        img_np, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=15,
        C=8
    )
    denoised = cv2.fastNlMeansDenoising(binary, h=10)
    return Image.fromarray(denoised).convert("RGB")


def deduplicate_by_iou(bounds, iou_threshold=0.5):
    """กรองกล่องซ้ำออกโดยใช้ Intersection over Minimum Area (IoM) เพื่อรองรับกล่องซ้อนทับ"""
    kept = []
    iom_threshold = 0.65  # ใช้ IoM threshold แทน IoU เพื่อกรองกล่องซ้อนทับได้ดีกว่า
    for b in bounds:
        pts = b[0]
        bx1 = min(p[0] for p in pts)
        by1 = min(p[1] for p in pts)
        bx2 = max(p[0] for p in pts)
        by2 = max(p[1] for p in pts)
        area_b = (bx2 - bx1) * (by2 - by1)

        is_dup = False
        for k in kept:
            kpts = k[0]
            kx1 = min(p[0] for p in kpts)
            ky1 = min(p[1] for p in kpts)
            kx2 = max(p[0] for p in kpts)
            ky2 = max(p[1] for p in kpts)
            area_k = (kx2 - kx1) * (ky2 - ky1)

            inter_x = max(0, min(bx2, kx2) - max(bx1, kx1))
            inter_y = max(0, min(by2, ky2) - max(by1, ky1))
            inter = inter_x * inter_y
            
            min_area = min(area_b, area_k)
            if min_area > 0:
                iom = inter / min_area
                if iom > iom_threshold:
                    # เก็บกล่องที่มีความมั่นใจ (confidence) สูงกว่าไว้
                    if b[2] > k[2]:
                        kept.remove(k)
                        kept.append(b)
                    is_dup = True
                    break

        if not is_dup:
            kept.append(b)

    return kept


PADDLEOCR_FAILED = False

def run_paddle_ocr_fallback(img_np, lang="en"):
    """Runs PaddleOCR as fallback. Returns empty list on failure."""
    global paddle_reader_en, paddle_reader_ko, PADDLEOCR_FAILED
    if not HAS_PADDLEOCR or PADDLEOCR_FAILED:
        return []
    try:
        reader = paddle_reader_ko if lang == "ko" else paddle_reader_en
        if reader is None:
            return []
        res_gen = reader.predict(img_np)
        res_list = list(res_gen)
        parsed_results = []
        if isinstance(res_list, list) and len(res_list) > 0:
            image_res = res_list[0]
            if image_res is not None:
                for line in image_res:
                    if len(line) == 2 and isinstance(line[0], list) and isinstance(line[1], tuple):
                        pts = line[0]
                        text = line[1][0]
                        conf = float(line[1][1])
                        parsed_results.append((pts, text, conf))
        return parsed_results
    except Exception as e:
        print("PaddleOCR failed or not supported on this platform, skipping:", e)
        PADDLEOCR_FAILED = True
        return []


def run_multipass_ocr_core(reader, img_np, lang="en"):
    """Run EasyOCR in 2 passes (Normal & Inverted) and deduplicate on a single chunk/image"""
    # Pass 1: ปกติ พร้อมเปิดเพิ่ม Margin และ Slope ให้ทนทานต่อฟอนต์เอียง (Italic)
    results1 = reader.readtext(img_np, paragraph=False, add_margin=0.25, width_ths=0.7, slope_ths=0.3, height_ths=0.6)

    # Pass 2: ภาพขาวดำ inverted
    img_inv = 255 - img_np
    results2 = reader.readtext(img_inv, paragraph=False, add_margin=0.25, width_ths=0.7, slope_ths=0.3, height_ths=0.6)

    all_results = results1 + results2
    dedup_results = deduplicate_by_iou(all_results)

    # PaddleOCR fallback for low confidence boxes
    confidence_threshold = 0.6
    low_conf_mask = [r[2] < confidence_threshold for r in dedup_results]
    if any(low_conf_mask) and HAS_PADDLEOCR:
        paddle_results = run_paddle_ocr_fallback(img_np, lang)
        if paddle_results:
            dedup_results = deduplicate_by_iou(dedup_results + paddle_results)

    return dedup_results


def run_multipass_ocr(reader, img_np, lang="en"):
    """Run EasyOCR with vertical slicing if the image is tall, otherwise run normal OCR"""
    H, W = img_np.shape[:2]
    if H <= 2000:
        return run_multipass_ocr_core(reader, img_np, lang)

    chunk_height = 2000
    overlap = 250
    print(f"  [OCR Slicing] Tall image detected ({W}x{H}). Slicing into vertical chunks of height {chunk_height} (overlap {overlap})...")

    all_results = []
    y_start = 0
    chunk_idx = 0

    while y_start < H:
        y_end = min(y_start + chunk_height, H)
        chunk = img_np[y_start:y_end, :]
        print(f"    - Processing Chunk #{chunk_idx+1}: Y-range [{y_start}:{y_end}]")

        chunk_results = run_multipass_ocr_core(reader, chunk, lang)

        # Shift Y coordinates of the bounding boxes back to the original image coordinate space
        for pts, text, conf in chunk_results:
            shifted_pts = []
            for pt in pts:
                shifted_pts.append([pt[0], pt[1] + y_start])
            all_results.append((shifted_pts, text, conf))

        if y_end == H:
            break
        y_start += (chunk_height - overlap)
        chunk_idx += 1

    # Deduplicate the combined results from all chunks using Intersection over Minimum Area (IoM)
    dedup_results = deduplicate_by_iou(all_results)
    print(f"  [OCR Slicing] Slicing complete. Merged and deduplicated {len(all_results)} raw boxes down to {len(dedup_results)} final boxes.")
    return dedup_results


def translate_with_gemini(text, source_lang="en", target_lang="th", max_retries=3):
    import time
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("No Gemini/Google API Key found in environment.")
    client = genai.Client(api_key=api_key)
    prompt = (
        f"You are a professional manga/comic translator from {source_lang} to {target_lang}.\n"
        f"Translate the following text naturally, preserving manga slang, tone, capitalization of names, and punctuation.\n"
        f"Only output the translation, without any explanations or extra characters.\n"
        f"Text to translate:\n{text}"
    )
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
            )
            return response.text.strip()
        except Exception as e:
            err_str = str(e)
            is_rate_limit = "429" in err_str or "quota" in err_str.lower() or "rate" in err_str.lower()
            if is_rate_limit and attempt < max_retries - 1:
                wait_secs = 2 ** (attempt + 1)
                print(f"Gemini rate limited (attempt {attempt+1}), retrying in {wait_secs}s...")
                time.sleep(wait_secs)
            else:
                raise
    raise RuntimeError("Gemini max retries exceeded")


def translate_with_context_gemini(texts_list, source_lang="en", target_lang="th", max_retries=3):
    import time
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("No API Key found.")
    client = genai.Client(api_key=api_key)
    formatted_items = "\n".join(f"[{idx}]: {t}" for idx, t in enumerate(texts_list))
    prompt = (
        f"You are a professional manga/comic translator from {source_lang} to {target_lang}.\n"
        f"Translate the following list of dialogue texts. Keep their original context in mind to ensure smooth, natural flow.\n"
        f"Preserve capitalization of names, manga slang, tone, and punctuation.\n"
        f"IMPORTANT: The input texts are OCR results and may contain merged words without spaces due to letters touching (e.g., 'HESCUIDINGTHESWORDSATNT', 'SAINTGUILDToceARNTHESWORD', 'TBSWORDSAINTOSSOPUITIFUL', 'OTAUCHT', 'THESWORDSAINTCUILDALLUTHEIR', 'I5JusTiTHAT', 'DONTHAVE', 'SOICANT', 'CONDENGETHAT', 'SWORDENERGY').\n"
        f"Before translating, you MUST reconstruct the correct English sentences by segmenting merged words and correcting spelling errors (e.g., 'He's guiding the sword saint to learn the sword? This is horrifying and heartbreaking.!!', 'The sword saint is so pitiful...!!', 'I taught the sword saint guild all their swordsmanship, so what the hero is saying is...', 'It's just that I don't have magic, so I can't condense that kind of magic sword energy...').\n"
        f"Output the translations in the exact same order and format as: [idx]: translated_text.\n"
        f"Only return the list of translations, no extra conversational introduction or notes.\n\n"
        f"{formatted_items}"
    )
    response = None
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
            )
            break
        except Exception as e:
            err_str = str(e)
            is_rate_limit = "429" in err_str or "quota" in err_str.lower() or "rate" in err_str.lower()
            if is_rate_limit and attempt < max_retries - 1:
                wait_secs = 2 ** (attempt + 1)
                print(f"Gemini rate limited (attempt {attempt+1}), retrying in {wait_secs}s...")
                time.sleep(wait_secs)
            else:
                raise
    if response is None:
        raise RuntimeError("Gemini failed after retries")

    lines = response.text.strip().split("\n")
    results = [""] * len(texts_list)
    for line in lines:
        match = re.match(r'^\[(\d+)\]:\s*(.*)$', line.strip())
        if match:
            idx = int(match.group(1))
            translation = match.group(2).strip()
            if idx < len(results):
                results[idx] = translation

    # Fallback สำหรับช่องที่ว่าง (สลับไปใช้ Google Translator ทันทีเพื่อไม่ให้ติด Gemini Rate Limit)
    for idx, res in enumerate(results):
        if not res:
            try:
                translated_val = GoogleTranslator(source=source_lang, target='th').translate(texts_list[idx])
                results[idx] = refine_thai_translation(translated_val)
            except Exception:
                results[idx] = texts_list[idx]
    return results


def translate_with_context_ollama(texts_list, model_name, source_lang="en", target_lang="th"):
    import urllib.request
    import json
    
    formatted_items = "\n".join(f"[{idx}]: {t}" for idx, t in enumerate(texts_list))
    prompt = (
        f"You are a professional manga/comic translator from {source_lang} to {target_lang}.\n"
        f"Translate the following list of dialogue texts. Keep their original context in mind to ensure smooth, natural flow.\n"
        f"Preserve capitalization of names, manga slang, tone, and punctuation.\n"
        f"IMPORTANT: The input texts are OCR results and may contain merged words without spaces due to letters touching (e.g., 'HESCUIDINGTHESWORDSATNT', 'SAINTGUILDToceARNTHESWORD', 'TBSWORDSAINTOSSOPUITIFUL', 'OTAUCHT', 'THESWORDSAINTCUILDALLUTHEIR', 'I5JusTiTHAT', 'DONTHAVE', 'SOICANT', 'CONDENGETHAT', 'SWORDENERGY').\n"
        f"Before translating, you MUST reconstruct the correct English sentences by segmenting merged words and correcting spelling errors (e.g., 'He's guiding the sword saint to learn the sword? This is horrifying and heartbreaking.!!', 'The sword saint is so pitiful...!!', 'I taught the sword saint guild all their swordsmanship, so what the hero is saying is...', 'It's just that I don't have magic, so I can't condense that kind of magic sword energy...').\n"
        f"Output the translations in the exact same order and format as: [idx]: translated_text.\n"
        f"Only return the list of translations, no extra conversational introduction or notes.\n\n"
        f"{formatted_items}"
    )
    
    url = "http://127.0.0.1:11434/api/generate"
    payload = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.3
        }
    }
    
    headers = {"Content-Type": "application/json"}
    
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            if response.status == 200:
                resp_data = json.loads(response.read().decode('utf-8'))
                text_response = resp_data.get("response", "").strip()
                
                # Parse output
                lines = text_response.split("\n")
                results = [""] * len(texts_list)
                for line in lines:
                    match = re.match(r'^\[(\d+)\]:\s*(.*)$', line.strip())
                    if match:
                        idx = int(match.group(1))
                        translation = match.group(2).strip()
                        if idx < len(results):
                            results[idx] = translation
                
                # Fallback for any blank translations
                for idx, res in enumerate(results):
                    if not res:
                        try:
                            translated_val = GoogleTranslator(source=source_lang, target='th').translate(texts_list[idx])
                            results[idx] = refine_thai_translation(translated_val)
                        except Exception:
                            results[idx] = texts_list[idx]
                return results
    except Exception as e:
        print(f"  [Ollama Translation] Failed using local model {model_name}: {e}")
        return []


def translate_with_context(texts_list, source_lang="en", translator="gemini"):
    """
    ส่ง context ของหน้าทั้งหมดไปแปลพร้อมกัน
    translator สามารถเป็น:
      - "gemini": แปลด้วย Gemini 2.5 Flash, fallback เป็น Google Translate
      - "google_translate": แปลด้วย Google Translate โดยตรง
      - รุ่น Ollama เช่น "gemma2:9b", "qwen3:8b", "qwen2.5:3b", "llama3:8b", "llama3"
    """
    if not texts_list:
        return []

    results = [None] * len(texts_list)
    missing_indices = []
    missing_texts = []

    for idx, text in enumerate(texts_list):
        cache_key = (source_lang, translator, text.strip())
        if cache_key in text_translation_cache:
            results[idx] = text_translation_cache[cache_key]
        else:
            missing_indices.append(idx)
            missing_texts.append(text)

    if not missing_indices:
        return results

    # ทำการแปลเฉพาะตัวที่ขาด
    translated_missing = []

    if translator == "gemini":
        # ⚡ ใช้ Gemini ถ้ามี key
        if HAS_GENAI and (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")):
            try:
                print(f"  [AI Translation] Translating {len(missing_texts)} text boxes using Gemini...")
                translated_missing = translate_with_context_gemini(missing_texts, source_lang, "th")
                translated_missing = [refine_thai_translation(r.strip()) for r in translated_missing]
                print("  [AI Translation] Gemini batch translation completed successfully.")
            except Exception as e:
                print("  [AI Translation] Gemini context translation failed, falling back to Google Translate:", e)
    elif translator in ["gemma2:9b", "qwen3:8b", "qwen2.5:3b", "llama3:8b", "llama3"]:
        try:
            print(f"  [Local AI Translation] Translating {len(missing_texts)} text boxes using local model {translator}...")
            translated_missing = translate_with_context_ollama(missing_texts, translator, source_lang, "th")
            if translated_missing:
                translated_missing = [refine_thai_translation(r.strip()) for r in translated_missing]
                print(f"  [Local AI Translation] Ollama {translator} translation completed successfully.")
            else:
                print(f"  [Local AI Translation] Ollama returned empty, falling back to Google Translate.")
        except Exception as e:
            print(f"  [Local AI Translation] Ollama failed, falling back to Google Translate:", e)

    if not translated_missing:
        # ใช้ ⟦#⟧ เป็นตัวคั่นแทน ⟦SEP⟧ เพื่อป้องกันไม่ให้ Google แปลเป็นคำว่า กันยายน (September)
        DELIMITER = " ⟦#⟧ "
        combined = DELIMITER.join(missing_texts)
        try:
            print(f"  [Fallback Translation] Translating {len(missing_texts)} text boxes using Google Translate (Batch)...")
            translated = GoogleTranslator(
                source=source_lang,
                target='th'
            ).translate(combined)

            translated_clean = translated.replace("⟦ # ⟧", "⟦#⟧")
            translated_clean = translated_clean.replace("⟦# ⟧", "⟦#⟧")
            translated_clean = translated_clean.replace("⟦ #⟧", "⟦#⟧")
            translated_clean = translated_clean.replace("⟦#⟧", "⟦#⟧")

            parts = translated_clean.split("⟦#⟧")
            if len(parts) == len(missing_texts):
                translated_missing = [refine_thai_translation(p.strip()) for p in parts]
                print("  [Fallback Translation] Google Translate batch translation completed successfully.")
            else:
                print(f"  [Fallback Translation] Delimiter split mismatch: got {len(parts)}, expected {len(missing_texts)}")
        except Exception as e:
            print("  [Fallback Translation] Error during Google Translate fallback:", e)

    if not translated_missing:
        # Fallback: แปลทีละอัน
        print("  [Fallback Translation] Translating items one-by-one...")
        translated_missing = []
        for t in missing_texts:
            try:
                translated = GoogleTranslator(source=source_lang, target='th').translate(t)
                translated_missing.append(refine_thai_translation(translated))
            except Exception:
                translated_missing.append(t)

    # นำคำแปลกลับเข้าผลลัพธ์และบันทึกลง cache
    for i, idx in enumerate(missing_indices):
        res_val = translated_missing[i] if i < len(translated_missing) else missing_texts[i]
        results[idx] = res_val
        cache_key = (source_lang, translator, missing_texts[i].strip())
        text_translation_cache[cache_key] = res_val

    return results


@app.post("/translate_base64")
def translate_base64_endpoint(data: MangaRequest):
    t_start = time.time()
    try:
        # ใช้ MD5 hash ของข้อมูล base64 เป็น cache key
        image_key = hashlib.md5(data.image_base64.encode('utf-8')).hexdigest()
        if image_key in translation_cache:
            return {"image": translation_cache[image_key]}

        try:
            encoded = data.image_base64.strip()
            if encoded.startswith('"') and encoded.endswith('"'):
                encoded = encoded[1:-1]
            if "," in encoded:
                encoded = encoded.split(",", 1)[1]
            encoded = encoded.replace(" ", "+")
            encoded = re.sub(r'[\s\n\r]+', '', encoded)
            missing_padding = len(encoded) % 4
            if missing_padding:
                encoded += '=' * (4 - missing_padding)
            try:
                image_bytes = base64.b64decode(encoded)
            except Exception:
                image_bytes = base64.urlsafe_b64decode(encoded)
            img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        except Exception as img_err:
            print(f"  [Warning] Failed to decode or load base64 image data: {img_err}")
            raise HTTPException(status_code=400, detail="Invalid base64 image data")

        t_decode = time.time()

        # Save last input image to disk for debugging
        try:
            img.save(os.path.join(os.path.dirname(__file__), "last_input_image.png"))
        except Exception as save_err:
            print("Failed to save last input image:", save_err)

        orig_width, orig_height = img.size

        # 1. ⚡ ปรับสเกลภาพแบบ LANCZOS คมชัดสูง
        ocr_width = 1000
        if orig_width < 1000 or orig_width > ocr_width:
            ocr_height = int(orig_height * (ocr_width / orig_width))
            img_ocr = img.resize((ocr_width, ocr_height), Image.Resampling.LANCZOS)
            scale_x = orig_width / ocr_width
            scale_y = orig_height / ocr_height
        else:
            img_ocr = img
            scale_x = 1.0
            scale_y = 1.0

        img_np = np.array(img_ocr)
        t_preprocess = time.time()

        # รัน Multi-pass OCR
        selected_reader = reader_ko if data.source_lang == "ko" else reader_en
        bounds = run_multipass_ocr(selected_reader, img_np, data.source_lang)
        t_ocr = time.time()

        # 1.5 ⚡ Smart Layout Box Merger
        merged_ocr_boxes = merge_layout_boxes(img, bounds, scale_x, scale_y, data.source_lang)
        t_merge = time.time()

        # 2. ⚡ Batch Translation
        valid_bounds = []
        texts_to_translate = []

        for item in merged_ocr_boxes:
            text_eng = item["text_eng"]

            text_clean_eng = clean_text(text_eng, data.source_lang)
            if not text_clean_eng:
                continue

            valid_bounds.append({
                "x_min": item["x_min"],
                "y_min": item["y_min"],
                "x_max": item["x_max"],
                "y_max": item["y_max"],
                "text_eng_raw": text_eng,
                "text_eng": text_clean_eng
            })

            # ไม่ lowercase เพื่อรักษาชื่อเฉพาะ (Master Lin, etc.)
            texts_to_translate.append(text_clean_eng.replace('\n', ' ').strip())

        # แปลแบบ batch
        translated_texts = translate_with_context(texts_to_translate, data.source_lang, data.translation_model)
        t_translate = time.time()

        # แสดง Log การประมวลผลข้อความใน CMD อย่างเป็นระบบ
        print("\n" + "="*60)
        print("[+] [TRANSLATION PROCESS LOG]")
        print("="*60)
        for idx, item in enumerate(valid_bounds):
            raw = item["text_eng_raw"].replace('\n', ' ').strip()
            corrected = item["text_eng"].replace('\n', ' ').strip()
            translated = translated_texts[idx] if idx < len(translated_texts) else ""
            print(f"[{idx+1}] ----------------------------------------")
            try:
                print(f"  [OCR Raw]:   {raw}")
                print(f"  [Corrected]: {corrected}")
                print(f"  [Translated]: {translated}")
            except Exception:
                pass
        print("="*60 + "\n")

        # 3. ถมกล่องขาวและวาดข้อความภาษาไทย
        for idx, item in enumerate(valid_bounds):
            text_thai = translated_texts[idx] if idx < len(translated_texts) else ""
            if not text_thai or text_thai.strip() == "":
                continue

            x_min = item["x_min"]
            y_min = item["y_min"]
            x_max = item["x_max"]
            y_max = item["y_max"]

            box_width = x_max - x_min
            box_height = y_max - y_min

            # ดึงสีพื้นหลังและสีตัวอักษร
            bg_color, text_color = get_background_and_text_color(img, x_min, y_min, x_max, y_max)

            # ลบข้อความเดิมด้วย Mask-based eraser
            padding = 4
            clean_text_in_box(img, x_min - padding, y_min - padding, x_max + padding, y_max + padding, bg_color)

            # สร้าง Draw object
            draw = ImageDraw.Draw(img)

            # ค้นหาขนาดฟอนต์ที่เหมาะสม
            font, lines = get_optimal_font_and_lines(text_thai, box_width, box_height)

            # เขียนข้อความแบบกึ่งกลาง (Premium Centered Text)
            font_size = font.size if hasattr(font, 'size') else 14
            line_height = int(font_size * 1.25)
            total_text_height = len(lines) * line_height

            y_current = y_min + (box_height - total_text_height) // 2

            stroke_color = (0, 0, 0) if text_color == (255, 255, 255) else (255, 255, 255)
            for line in lines:
                bbox = font.getbbox(line)
                line_width = bbox[2] - bbox[0]
                x_current = x_min + (box_width - line_width) // 2
                draw.text((x_current, y_current), line, fill=text_color, font=font, stroke_width=1, stroke_fill=stroke_color)
                y_current += line_height

        t_render = time.time()

        output_buffer = io.BytesIO()
        img.save(output_buffer, format="JPEG")
        processed_bytes = output_buffer.getvalue()

        base64_result = "data:image/jpeg;base64," + base64.b64encode(processed_bytes).decode("utf-8")
        translation_cache[image_key] = base64_result
        t_encode = time.time()

        # Print consolidated Timing Metrics report
        d_decode = t_decode - t_start
        d_preprocess = t_preprocess - t_decode
        d_ocr = t_ocr - t_preprocess
        d_merge = t_merge - t_ocr
        d_translate = t_translate - t_merge
        d_render = t_render - t_translate
        d_encode = t_encode - t_render
        d_total = t_encode - t_start

        print("\n" + "="*60)
        print("[+] [TIMING METRICS]")
        print("="*60)
        print(f"  - Base64 Decode & Load:      {d_decode:.3f}s")
        print(f"  - Preprocessing & Resizing:  {d_preprocess:.3f}s")
        print(f"  - Multi-pass OCR:            {d_ocr:.3f}s")
        print(f"  - Layout Box Merger:         {d_merge:.3f}s")
        print(f"  - Text Translation:          {d_translate:.3f}s")
        print(f"  - Cleaning & Text Rendering: {d_render:.3f}s")
        print(f"  - JPEG Encoding & Cache:     {d_encode:.3f}s")
        print(f"  - TOTAL EXECUTION TIME:      {d_total:.3f}s")
        print("="*60 + "\n")

        return {"image": base64_result}

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health():
    return {
        "status": "ok",
        "gpu": use_gpu,
        "paddleocr": HAS_PADDLEOCR,
        "gemini": HAS_GENAI,
        "font": os.path.exists(THAI_FONT_PATH)
    }


@app.get("/manga-translator.user.js")
def get_userscript():
    from fastapi.responses import FileResponse
    userscript_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "userscript", "manga-translator.user.js")
    if os.path.exists(userscript_path):
        return FileResponse(userscript_path, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="Userscript file not found")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)