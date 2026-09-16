import os
import time
import subprocess
import shutil
import json
import re
import urllib.request
from core.cache_manager import text_cache

def is_ollama_alive():
    try:
        req = urllib.request.Request("http://127.0.0.1:11434/api/tags")
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            return resp.status == 200
    except Exception:
        return False

def ensure_ollama_running():
    """Auto-detects and launches Ollama service in background if currently offline."""
    if is_ollama_alive():
        return True
        
    ollama_bin = shutil.which("ollama")
    if not ollama_bin:
        local_path = os.path.expandvars(r"%LOCALAPPDATA%\Programs\Ollama\ollama.exe")
        if os.path.exists(local_path):
            ollama_bin = local_path
            
    if ollama_bin:
        print(f"[Ollama] Service is offline. Auto-launching: {ollama_bin} serve...")
        try:
            creation_flags = 0x08000000 if os.name == 'nt' else 0  # CREATE_NO_WINDOW
            subprocess.Popen([ollama_bin, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=creation_flags)
            for _ in range(12):  # Wait up to 6s
                time.sleep(0.5)
                if is_ollama_alive():
                    print("[Ollama] Ollama service connected and ready!")
                    return True
        except Exception as e:
            print(f"[Ollama] Failed to auto-start Ollama: {e}")
            
    return False

def unload_ollama_models():
    """Unloads any active Ollama models from VRAM to free GPU memory for OCR / cloud translation."""
    try:
        req = urllib.request.Request("http://127.0.0.1:11434/api/ps")
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            running = data.get("models", [])
            for m in running:
                m_name = m.get("name")
                if m_name:
                    unload_payload = {"model": m_name, "keep_alive": 0}
                    u_req = urllib.request.Request(
                        "http://127.0.0.1:11434/api/generate",
                        data=json.dumps(unload_payload).encode("utf-8"),
                        headers={"Content-Type": "application/json"}
                    )
                    urllib.request.urlopen(u_req, timeout=1.5)
                    print(f"[Ollama] Cleanly unloaded '{m_name}' to free VRAM for GPU OCR!")
    except Exception:
        pass

def _call_ollama_api(payload):
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=8.0) as resp:
        return json.loads(resp.read().decode("utf-8"))

def translate_batch_ollama(texts_list, source_lang="en", target_lang="th", model_name="gemma2:9b", timeout=7.0):
    """
    Translates manga dialogue batches using Local AI (Ollama).
    Guaranteed fast fallback: if local AI takes > 7s, instantly falls back to Google Translate!
    """
    if not texts_list:
        return []
        
    # Ensure Ollama daemon is running
    if not is_ollama_alive():
        ensure_ollama_running()
        
    results = [None] * len(texts_list)
    uncached_indices = []
    uncached_items = []
    
    for idx, t in enumerate(texts_list):
        t_clean = t.strip()
        cached = text_cache.get(f"ollama_{model_name}_{source_lang}_{target_lang}_{t_clean}")
        if cached:
            results[idx] = cached
        else:
            uncached_indices.append(idx)
            uncached_items.append(f"[{idx}]: {t_clean}")
            
    if not uncached_items:
        return results
        
    formatted = "\n".join(uncached_items)
    source_label = "English" if source_lang == "en" else source_lang
    system_prompt = (
        f"You are an expert manga and comic translator from {source_label} to Thai language (ภาษาไทย).\n"
        f"Deduce original dialogue context, correct comic font OCR typos automatically, and translate into natural, expressive Thai scanlation comic style (ภาษาไทย).\n"
        f"Format strictly line-by-line: [index]: translated_thai_text\n"
        f"Only return the translated list in Thai. Do not add conversational replies or explanations.\n"
        f"IMPORTANT: Do not add speaker tags, sound effect labels, quotes, or trailing colons (:) to the dialogue."
    )
    
    # Dynamic predict tokens: ~80 tokens per dialogue line, min 256, max 1024
    max_tokens = min(1024, max(256, len(uncached_items) * 80))
    
    payload = {
        "model": model_name,
        "system": system_prompt,
        "prompt": formatted,
        "stream": False,
        "keep_alive": "2m",
        "options": {
            "temperature": 0.15,
            "num_predict": max_tokens,
            "num_ctx": 2048,
            "num_thread": 8,
            "stop": ["\n\n\n", "Note:", "Explanation:", "Here is", "Let me know"]
        }
    }
    
    # Free PyTorch CUDA cache before calling Ollama to maximize available VRAM
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
    
    from concurrent.futures import ThreadPoolExecutor
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_call_ollama_api, payload)
            data = future.result(timeout=timeout)
            text_out = data.get("response", "").strip()
            
            from typesetter.thai_formatter import clean_manga_text
            for line in text_out.split("\n"):
                line = line.strip()
                match = re.match(r'^\[?(\d+)\]?[\.\:\-\s]+(.*)$', line)
                if match:
                    orig_idx = int(match.group(1))
                    raw_trans = match.group(2).strip()
                    orig_en = texts_list[orig_idx] if orig_idx < len(texts_list) else ""
                    trans_text = clean_manga_text(raw_trans, orig_en)
                    # Only accept if output actually contains Thai characters
                    has_thai = bool(re.search(r'[\u0e00-\u0e7f]', trans_text))
                    if has_thai and orig_idx < len(results):
                        results[orig_idx] = trans_text
                        text_cache[f"ollama_{model_name}_{source_lang}_{target_lang}_{texts_list[orig_idx].strip()}"] = trans_text
    except Exception as e:
        print(f"[Ollama Translator] Notice: {model_name} timed out (> {timeout}s) or failed. Seamlessly switching to Google Translate!")
        
    # Auto-fallback to Google Translate for any missed or non-Thai lines
    missing_indices = [i for i, r in enumerate(results) if r is None]
    if missing_indices:
        missing_texts = [texts_list[i] for i in missing_indices]
        try:
            from translator.google_engine import translate_texts_google
            from typesetter.thai_formatter import clean_manga_text
            google_trans = translate_texts_google(missing_texts, source_lang, target_lang)
            for i, trans in zip(missing_indices, google_trans):
                results[i] = clean_manga_text(trans, texts_list[i])
            print(f"[Ollama Translator] Successfully recovered {len(missing_texts)} dialogues via Google Translate fallback (< 0.2s)!")
        except Exception as fb_err:
            print(f"[Ollama Translator] Fallback error: {fb_err}")
            for i in missing_indices:
                results[i] = texts_list[i]
                
    return results
