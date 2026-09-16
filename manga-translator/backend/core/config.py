import os
import torch

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Load .env
env_path = os.path.join(BASE_DIR, ".env")
if not os.path.exists(env_path):
    env_path = os.path.join(os.path.dirname(BASE_DIR), ".env")
if os.path.exists(env_path):
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ[key.strip()] = val.strip()
    except Exception as e:
        print("Failed to load .env file:", e)

# Environment flags for stability
os.environ["FLAGS_use_onednn"] = "0"
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

# Hardware
CUDA_AVAILABLE = torch.cuda.is_available()
DEVICE = "cuda" if CUDA_AVAILABLE else "cpu"

# Gemini API
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# Fonts
DEFAULT_THAI_FONT = os.path.join(BASE_DIR, "Sarabun-Regular.ttf")
WINDOWS_FONT_DIR = r"C:\Windows\Fonts"
TAHOMA_BOLD_FONT = os.path.join(WINDOWS_FONT_DIR, "tahomabd.ttf")
TAHOMA_REGULAR_FONT = os.path.join(WINDOWS_FONT_DIR, "tahoma.ttf")

# Dictionaries
ENGLISH_WORDS_PATH = os.path.join(BASE_DIR, "english_words.txt")
ENGLISH_WORDS_LARGE_PATH = os.path.join(BASE_DIR, "english_words_large.txt")
