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

# ==============================================================================
# GOLDEN BASELINE CONFIGURATION (VERIFIED OPTIMAL PRODUCTION PARAMETERS)
# Locked on 2026-09-17: High-accuracy OCR, zero text squashing, pristine inpainting
# ==============================================================================
GOLDEN_BASELINE_CONFIG = {
    "version": "2.0-golden-baseline",
    
    # 1. Webtoon Long-Strip Auto-Tiling
    "tiling": {
        "strip_min_height": 2400,        # Trigger auto-tiling if image height > 2400px
        "strip_min_aspect_ratio": 1.8,    # Trigger if height/width > 1.8
        "chunk_height": 2200,            # Tile height matching native CRAFT canvas
        "chunk_overlap": 300,            # 300px overlap to prevent cutting speech bubbles
        "step_stride": 1900,             # 2200 - 300 = 1900px step
        "nms_iou_threshold": 0.55,       # Non-Maximum Suppression overlap threshold
    },
    
    # 2. EasyOCR Settings
    "ocr": {
        "canvas_size": 2200,             # Native resolution canvas (prevents 5x squashing)
        "batch_size": 16,                # Optimal GPU batch processing
        "inverted_dark_brightness": 95,  # Recover inverted dark dialogue crops
        "inverted_dark_min_conf": 0.45,  # Confidence cutoff for inverted recovery
    },
    
    # 3. Comic-Text-Detector (ONNX)
    "detector": {
        "target_size": 1024,             # Model inference size
        "seg_threshold": 0.25,           # Text stroke binary segmentation cutoff
        "dilation_kernel_size": 3,       # 3x3 ellipse kernel
        "dilation_iterations": 2,        # 2 passes dilation covering text antialiasing
        "min_contour_area": 25,          # Filter out tiny noise specks
        "cluster_v_gap_min": -5,         # Clamp: prevent leaps across art/faces
        "cluster_v_gap_max_abs": 24,     # Maximum 24px vertical gap between lines
        "cluster_v_gap_max_rel": 1.2,    # Or 1.2 * line_height
        "cluster_h_overlap_min": -20,    # Horizontal line alignment tolerance
    },
    
    # 4. Inpainting & Artwork Protection
    "inpainting": {
        "pad_top_max": 20,               # Maximum top padding to prevent face smears
        "pad_bottom_max": 30,            # Maximum bottom padding
        "pad_x_max": 15,                 # Maximum horizontal padding
        "uniformity_std_max": 25,        # Reject illustration backgrounds if std >= 25
        "white_bubble_lum_min": 185,     # White speech bubble threshold
    },
    
    # 5. Typesetting & Thai Formatting
    "typesetter": {
        "font_family": "Prompt / Sarabun / Tahoma Bold",
        "stroke_width_range": (2, 3),    # 2-3px outline for high contrast readability
        "padding_pct": 0.08,             # 8% inner padding from bubble boundary
    }
}

