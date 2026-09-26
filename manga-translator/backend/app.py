import os
import sys
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from api.v1.translate_routes import router as api_router
from core.config import BASE_DIR

app = FastAPI(title="World-Class Manga Universal Translator", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_private_network=True,
)

# Include modular API routes
app.include_router(api_router)

@app.get("/")
def root():
    return {"message": "World-Class Manga Translator Backend 2.0 is running!"}

@app.get("/manga-translator.user.js")
def get_userscript():
    userscript_path = os.path.join(os.path.dirname(BASE_DIR), "userscript", "manga-translator.user.js")
    if os.path.exists(userscript_path):
        return FileResponse(userscript_path, media_type="application/javascript")
    return {"error": "Userscript file not found"}

if __name__ == "__main__":
    print("\n=======================================================")
    print("[*] WORLD-CLASS MANGA TRANSLATOR 2.0 (MODULAR ARCHITECTURE)")
    print("[*] 100% Offline OCR (CUDA) | Stroke-level Inpainting | Smart Typesetter")
    print("[*] Chrome Extension / Tampermonkey URL:")
    print("[*] ---> http://127.0.0.1:8000 <---")
    print("[*] (Note: Use 127.0.0.1 or localhost in browsers. Do not use 0.0.0.0)")
    print("=======================================================\n")
    uvicorn.run(app, host="0.0.0.0", port=8000, timeout_graceful_shutdown=2)
