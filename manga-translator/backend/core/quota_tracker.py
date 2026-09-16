import os
import json
import time
import threading
from datetime import datetime

CASCADE_MODELS_DEF = [
    {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "daily_limit": 1500, "tier": "Smartest"},
    {"id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash", "daily_limit": 1500, "tier": "Balanced & Fast"},
    {"id": "gemini-2.0-flash-lite", "name": "Gemini 2.0 Flash-Lite", "daily_limit": 1500, "tier": "Ultra Fast"},
    {"id": "gemini-1.5-flash", "name": "Gemini 1.5 Flash", "daily_limit": 1500, "tier": "Classic Stable"},
    {"id": "gemini-1.5-flash-8b", "name": "Gemini 1.5 Flash-8B", "daily_limit": 1500, "tier": "Lightweight"}
]

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
QUOTA_FILE = os.path.join(DATA_DIR, "gemini_quota.json")

class GeminiQuotaTracker:
    def __init__(self):
        self._lock = threading.Lock()
        os.makedirs(DATA_DIR, exist_ok=True)
        self._load_or_init()

    def _today_str(self):
        return datetime.now().strftime("%Y-%m-%d")

    def _load_or_init(self):
        today = self._today_str()
        if os.path.exists(QUOTA_FILE):
            try:
                with open(QUOTA_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if data.get("date") == today:
                    self.data = data
                    self._ensure_models_present()
                    return
            except Exception as e:
                print(f"[QuotaTracker] Error reading {QUOTA_FILE}, reinitializing: {e}")
        
        # Initialize fresh day
        self.data = {
            "date": today,
            "models": {
                m["id"]: {
                    "used": 0,
                    "limit": m["daily_limit"],
                    "status": "ready",
                    "last_used": None,
                    "last_error": None
                } for m in CASCADE_MODELS_DEF
            }
        }
        self._save()

    def _ensure_models_present(self):
        modified = False
        if "models" not in self.data:
            self.data["models"] = {}
            modified = True
        for m in CASCADE_MODELS_DEF:
            mid = m["id"]
            if mid not in self.data["models"]:
                self.data["models"][mid] = {
                    "used": 0,
                    "limit": m["daily_limit"],
                    "status": "ready",
                    "last_used": None,
                    "last_error": None
                }
                modified = True
        if modified:
            self._save()

    def _save(self):
        try:
            with open(QUOTA_FILE, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[QuotaTracker] Failed to save {QUOTA_FILE}: {e}")

    def check_date_reset(self):
        today = self._today_str()
        if self.data.get("date") != today:
            print(f"[QuotaTracker] New day detected ({today}). Resetting daily Gemini quotas.")
            self.data["date"] = today
            for m in CASCADE_MODELS_DEF:
                mid = m["id"]
                self.data["models"][mid] = {
                    "used": 0,
                    "limit": m["daily_limit"],
                    "status": "ready",
                    "last_used": None,
                    "last_error": None
                }
            self._save()

    def record_usage(self, model_id):
        with self._lock:
            self.check_date_reset()
            if model_id in self.data["models"]:
                m_info = self.data["models"][model_id]
                m_info["used"] += 1
                m_info["last_used"] = time.strftime("%Y-%m-%d %H:%M:%S")
                # If reached limit, mark exhausted
                if m_info["used"] >= m_info["limit"]:
                    m_info["status"] = "exhausted"
                else:
                    m_info["status"] = "ready"
                self._save()

    def record_exhausted(self, model_id, error_msg="Quota exhausted or rate limit hit"):
        with self._lock:
            self.check_date_reset()
            if model_id in self.data["models"]:
                m_info = self.data["models"][model_id]
                m_info["status"] = "exhausted"
                m_info["last_error"] = str(error_msg)[:200]
                print(f"[QuotaTracker] Model [{model_id}] marked EXHAUSTED: {error_msg}")
                self._save()

    def record_rate_limited(self, model_id, error_msg="RPM limit reached"):
        with self._lock:
            self.check_date_reset()
            if model_id in self.data["models"]:
                m_info = self.data["models"][model_id]
                m_info["status"] = "rate_limited"
                m_info["last_error"] = str(error_msg)[:200]
                print(f"[QuotaTracker] Model [{model_id}] marked RATE_LIMITED: {error_msg}")
                self._save()

    def get_candidate_models(self):
        """Returns ordered list of models that are ready, followed by rate_limited, then exhausted."""
        with self._lock:
            self.check_date_reset()
            ready = []
            rate_limited = []
            exhausted = []
            for m in CASCADE_MODELS_DEF:
                mid = m["id"]
                status = self.data["models"].get(mid, {}).get("status", "ready")
                if status == "ready":
                    ready.append(mid)
                elif status == "rate_limited":
                    rate_limited.append(mid)
                else:
                    exhausted.append(mid)
            # Prioritize ready -> rate_limited -> exhausted
            ordered = ready + rate_limited + exhausted
            return ordered if ordered else [m["id"] for m in CASCADE_MODELS_DEF]

    def get_status(self):
        with self._lock:
            self.check_date_reset()
            models_list = []
            total_used = 0
            total_limit = 0
            active_model = None

            for m in CASCADE_MODELS_DEF:
                mid = m["id"]
                m_data = self.data["models"].get(mid, {
                    "used": 0, "limit": m["daily_limit"], "status": "ready"
                })
                used = m_data.get("used", 0)
                limit = m_data.get("limit", m["daily_limit"])
                status = m_data.get("status", "ready")
                remaining = max(0, limit - used)
                
                total_used += used
                total_limit += limit

                if active_model is None and status == "ready":
                    active_model = mid

                models_list.append({
                    "id": mid,
                    "name": m["name"],
                    "tier": m["tier"],
                    "used": used,
                    "limit": limit,
                    "remaining": remaining,
                    "status": status,
                    "last_used": m_data.get("last_used"),
                    "last_error": m_data.get("last_error")
                })

            if active_model is None and models_list:
                active_model = models_list[0]["id"]

            return {
                "date": self.data.get("date"),
                "active_model": active_model,
                "total_used": total_used,
                "total_limit": total_limit,
                "total_remaining": max(0, total_limit - total_used),
                "models": models_list
            }

quota_tracker = GeminiQuotaTracker()
