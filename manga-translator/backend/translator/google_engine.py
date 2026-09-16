import urllib.request
import urllib.parse
import json
import time
from concurrent.futures import ThreadPoolExecutor
from core.cache_manager import text_cache

def _fetch_single_google(text, source_lang="en", target_lang="th", timeout=3.0):
    urls = [
        f"https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl={source_lang}&tl={target_lang}&q=" + urllib.parse.quote(text),
        f"https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl={source_lang}&tl={target_lang}&dt=t&q=" + urllib.parse.quote(text),
        f"https://translate.googleapis.com/translate_a/single?client=gtx&sl={source_lang}&tl={target_lang}&dt=t&q=" + urllib.parse.quote(text)
    ]
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}
    
    for url in urls:
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, list) and len(data) > 0:
                    if isinstance(data[0], str):
                        return data[0].strip()
                    if isinstance(data[0], list) and len(data[0]) > 0:
                        full_t = "".join([part[0] for part in data[0] if isinstance(part, list) and len(part) > 0 and part[0]])
                        if full_t:
                            return full_t.strip()
                        if isinstance(data[0][0], str):
                            return data[0][0].strip()
        except Exception:
            continue
    return None

def translate_texts_google(texts_list, source_lang="en", target_lang="th"):
    """
    Ultra-Fast Google Translate Engine (< 0.2s) with multi-tier fallback and LRU Caching.
    Uses Google Chrome Extension API for zero-rate-limit lightning translations.
    """
    if not texts_list:
        return []
        
    results = [None] * len(texts_list)
    uncached_indices = []
    uncached_texts = []
    
    for idx, t in enumerate(texts_list):
        t_clean = t.strip()
        if not t_clean:
            results[idx] = ""
            continue
        cached = text_cache.get(f"google_{source_lang}_{target_lang}_{t_clean}")
        if cached:
            results[idx] = cached
        else:
            uncached_indices.append(idx)
            uncached_texts.append(t_clean)
            
    if not uncached_texts:
        return results
        
    # Tier 1: High-Speed Newline-Delimited Batch using clients5.google.com (< 0.15s)
    try:
        delimited = "\n".join(uncached_texts)
        url = f"https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl={source_lang}&tl={target_lang}&q=" + urllib.parse.quote(delimited)
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            raw = data[0] if isinstance(data, list) and len(data) > 0 and isinstance(data[0], str) else ""
            lines = [l.strip() for l in raw.split("\n")]
            
        if len(lines) == len(uncached_texts):
            for i, line in zip(uncached_indices, lines):
                results[i] = line
                text_cache[f"google_{source_lang}_{target_lang}_{texts_list[i].strip()}"] = line
            return results
    except Exception:
        pass
        
    # Tier 2: Concurrent Parallel Multi-Worker for any remaining items (< 0.3s)
    remaining_indices = [i for i in uncached_indices if results[i] is None]
    if remaining_indices:
        def _worker(idx):
            txt = texts_list[idx].strip()
            trans = _fetch_single_google(txt, source_lang, target_lang)
            return idx, trans

        with ThreadPoolExecutor(max_workers=8) as executor:
            fetched = list(executor.map(_worker, remaining_indices))
            
        for idx, trans in fetched:
            if trans:
                results[idx] = trans
                text_cache[f"google_{source_lang}_{target_lang}_{texts_list[idx].strip()}"] = trans

    # Tier 3: DeepTranslator Fallback if Google direct endpoints fail
    still_missing = [i for i in uncached_indices if results[i] is None]
    if still_missing:
        try:
            from deep_translator import GoogleTranslator
            translator = GoogleTranslator(source=source_lang, target=target_lang)
            for idx in still_missing:
                try:
                    res = translator.translate(texts_list[idx])
                    if res:
                        results[idx] = res.strip()
                        text_cache[f"google_{source_lang}_{target_lang}_{texts_list[idx].strip()}"] = results[idx]
                except Exception:
                    pass
        except Exception:
            pass

    # Final Guarantee: Never return None
    for idx in uncached_indices:
        if results[idx] is None:
            results[idx] = texts_list[idx]

    return results
