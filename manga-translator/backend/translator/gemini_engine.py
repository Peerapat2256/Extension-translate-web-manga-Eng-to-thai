import os
import re
import time
from core.config import GEMINI_API_KEY
from core.cache_manager import text_cache

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

try:
    from google import genai
    from google.genai import types
    HAS_GENAI = True
except ImportError:
    HAS_GENAI = False

_cached_client = None

def get_gemini_client():
    global _cached_client
    if _cached_client is None and HAS_GENAI:
        api_key = GEMINI_API_KEY or os.environ.get("GOOGLE_API_KEY")
        if api_key:
            try:
                _cached_client = genai.Client(
                    api_key=api_key,
                    http_options=types.HttpOptions(
                        retry_options=types.HttpRetryOptions(attempts=1)
                    )
                )
            except Exception:
                _cached_client = genai.Client(api_key=api_key)
    return _cached_client

_gemini_executor = ThreadPoolExecutor(max_workers=4)

def translate_batch_gemini(texts_list, source_lang="en", target_lang="th", preferred_model=None):
    """
    Sends all texts on the manga page in a single batch call to Gemini.
    Protected with a strict deadline and zero SDK retry hangs.
    If preferred_model is specified, prioritizes that model first;
    otherwise auto-cascades through all ready models.
    Instantly falls back to Google Translate on timeout or high load.
    """
    if not texts_list:
        return []
        
    client = get_gemini_client()
    if client is None:
        from translator.google_engine import translate_texts_google
        return translate_texts_google(texts_list, source_lang, target_lang)
    
    results = [None] * len(texts_list)
    uncached_indices = []
    uncached_items = []
    
    for idx, t in enumerate(texts_list):
        t_clean = t.strip()
        cached = text_cache.get(f"gemini_{source_lang}_{target_lang}_{t_clean}")
        if cached:
            results[idx] = cached
        else:
            uncached_indices.append(idx)
            uncached_items.append(f"[{idx}]: {t_clean}")
            
    if not uncached_items:
        return results
        
    formatted = "\n".join(uncached_items)
    prompt = (
        f"You are an expert manga and comic translator from {source_lang} to {target_lang}.\n"
        f"The input texts are scanned from manga with stylized comic fonts and may contain OCR artifacts (e.g. 'Vou' -> 'You', 'Cuvs' -> 'Guys', 'Wkere' -> 'Where', 'YM' -> 'I\'m', 'COCK' -> 'COOK').\n"
        f"Deduce the intended original dialogue context, correct OCR typos automatically, and translate into natural, expressive Thai scanlation comic style (ภาษาการ์ตูนไทยสละสลวยได้อารมณ์).\n"
        f"Preserve names, character tone, exclamation, emotional nuances, and comic slang.\n"
        f"Format your output strictly line-by-line as: [index]: translated_text\n"
        f"Only return the translated list, with no explanations, speaker labels, quotes, or trailing colons (:):\n\n"
        f"{formatted}"
    )
    
    gemini_succeeded = False
    from core.quota_tracker import quota_tracker
    candidate_models = quota_tracker.get_candidate_models(preferred_model=preferred_model)
    if preferred_model and preferred_model != "auto":
        print(f"[*] Translating with preferred model: [{preferred_model}] (Cascade candidates: {candidate_models[:3]}...)")
    else:
        print(f"[*] Gemini Auto-Cascade order: {candidate_models}")
    
    def _call_gemini(model_name):
        return client.models.generate_content(
            model=model_name,
            contents=prompt
        )

    for model_name in candidate_models:
        try:
            future = _gemini_executor.submit(_call_gemini, model_name)
            # Safe 5.5s timeout per call to ensure high quality without hangs
            response = future.result(timeout=5.5)
                
            text_out = response.text.strip()
            from typesetter.thai_formatter import clean_manga_text
            for line in text_out.split("\n"):
                line = line.strip()
                match = re.match(r'^\[?(\d+)\]?[\.\:\-\s]+(.*)$', line)
                if match:
                    orig_idx = int(match.group(1))
                    raw_trans = match.group(2).strip()
                    orig_en = texts_list[orig_idx] if orig_idx < len(texts_list) else ""
                    trans_text = clean_manga_text(raw_trans, orig_en)
                    if orig_idx < len(results):
                        results[orig_idx] = trans_text
                        text_cache[f"gemini_{source_lang}_{target_lang}_{texts_list[orig_idx].strip()}"] = trans_text
            
            # Record successful call in quota tracker
            quota_tracker.record_usage(model_name)
            print(f"[Translator] Gemini model [{model_name}] translated successfully.")
            gemini_succeeded = True
            break
        except FutureTimeoutError:
            print(f"[Translator] Gemini model [{model_name}] timed out (>5.5s). Cascading to next model...")
            continue
        except Exception as e:
            err_str = str(e)
            quota_tracker.record_error(model_name, err_str)
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                print(f"[Translator] Gemini model [{model_name}] hit rate limit (429/RPM). Auto-cascading to next model...")
            else:
                print(f"[Translator] Gemini model [{model_name}] temporary unavailable ({e}). Cascading to next model...")
            continue
                
    # Auto-fallback to Google Translate for any missing/untranslated items
    missing_indices = [i for i, r in enumerate(results) if r is None]
    if missing_indices:
        missing_texts = [texts_list[i] for i in missing_indices]
        try:
            from translator.google_engine import translate_texts_google
            google_trans = translate_texts_google(missing_texts, source_lang, target_lang)
            for i, trans in zip(missing_indices, google_trans):
                results[i] = trans
        except Exception as g_err:
            print("[Translator] Google Translate fallback also failed:", g_err)
            for i in missing_indices:
                results[i] = texts_list[i]
            
    return results
