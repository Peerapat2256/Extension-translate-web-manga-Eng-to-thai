import os
import json
import time
import threading
from datetime import datetime

CASCADE_MODELS_DEF = [
    {
        "id": "gemini-3.5-flash-lite",
        "name": "Gemini 3.5 Flash-Lite",
        "avg_speed": "~0.8s",
        "daily_limit": 1500,
        "tier": "เร็วจัด (Ultra Fast)",
        "desc": "เบาและเร็วที่สุด ประหยัดโควต้า เหมาะกับการอ่านต่อเนื่อง"
    },
    {
        "id": "gemini-flash-lite-latest",
        "name": "Gemini Flash-Lite Latest",
        "avg_speed": "~0.9s",
        "daily_limit": 1500,
        "tier": "สแลงการ์ตูนมันส์",
        "desc": "เร็วมาก ภาษาการ์ตูนสละสลวย เข้าใจสแลงวัยรุ่น"
    },
    {
        "id": "gemini-3.1-flash-lite",
        "name": "Gemini 3.1 Flash-Lite",
        "avg_speed": "~1.2s",
        "daily_limit": 1500,
        "tier": "เสถียรน้ำหนักเบา",
        "desc": "โมเดลเสถียร น้ำหนักเบา ตอบสนองฉับไว"
    },
    {
        "id": "gemini-3-flash-preview",
        "name": "Gemini 3 Flash Preview",
        "avg_speed": "~3.2s",
        "daily_limit": 1500,
        "tier": "สปีดแฟลชยุคใหม่",
        "desc": "เทคโนโลยี Flash ยุคใหม่ แปลแม่นยำสูง"
    },
    {
        "id": "gemini-3.8-flash",
        "name": "Gemini 3.8 Flash",
        "avg_speed": "~4.1s",
        "daily_limit": 1500,
        "tier": "สเปกสูง",
        "desc": "รุ่นความสามารถสูง เข้าใจรูปประโยคมังงะซับซ้อน"
    },
    {
        "id": "gemini-flash-latest",
        "name": "Gemini Flash Latest",
        "avg_speed": "~4.3s",
        "daily_limit": 1500,
        "tier": "ฉลาดสมดุล (แนะนำ)",
        "desc": "โมเดลหลักมาตรฐาน ฉลาด สมดุล คุณภาพสูง"
    },
    {
        "id": "gemini-3.6-flash",
        "name": "Gemini 3.6 Flash",
        "avg_speed": "~5.9s",
        "daily_limit": 1500,
        "tier": "คมชัดละเอียด",
        "desc": "เจเนอเรชันใหม่ แปลเก็บรายละเอียดคำพูดครบถ้วน"
    },
    {
        "id": "gemini-2.5-flash",
        "name": "Gemini 2.5 Flash",
        "avg_speed": "~8.4s",
        "daily_limit": 1500,
        "tier": "คลาสสิกลึกซึ้ง",
        "desc": "รุ่นคลาสสิก ฉลาดลึกซึ้ง (อาจมีคิวรอช่วงผู้ใช้หนาแน่น)"
    },
    {
        "id": "gemini-3.5-flash",
        "name": "Gemini 3.5 Flash",
        "avg_speed": "~12.9s",
        "daily_limit": 1500,
        "tier": "บริบทสูงสุด",
        "desc": "วิเคราะห์บริบทระดับสูงสุด แปลเนื้อเรื่องเข้มข้น"
    }
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
        
        # Remove deprecated model IDs no longer in CASCADE_MODELS_DEF
        active_ids = {m["id"] for m in CASCADE_MODELS_DEF}
        for old_id in list(self.data["models"].keys()):
            if old_id not in active_ids:
                del self.data["models"][old_id]
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

    def _check_expired_rate_limits(self):
        now = time.time()
        modified = False
        for mid, m_info in self.data["models"].items():
            if m_info.get("status") == "rate_limited":
                rl_until = m_info.get("rate_limited_until", 0)
                if now >= rl_until:
                    m_info["status"] = "ready"
                    m_info["rate_limited_until"] = None
                    m_info["last_error"] = None
                    modified = True
                    print(f"[QuotaTracker] Model [{mid}] RPM cooldown finished -> restored to READY.")
            elif m_info.get("status") == "exhausted" and m_info.get("used", 0) < m_info.get("limit", 1500):
                # If marked exhausted but used is under 1,500, it was an RPM burst limit, not daily exhaustion!
                m_info["status"] = "ready"
                m_info["rate_limited_until"] = None
                m_info["last_error"] = None
                modified = True
                print(f"[QuotaTracker] Auto-corrected false exhausted on [{mid}] (used {m_info['used']}/{m_info['limit']}) -> READY.")
        if modified:
            self._save()

    def record_usage(self, model_id):
        with self._lock:
            self.check_date_reset()
            self._check_expired_rate_limits()
            if model_id in self.data["models"]:
                m_info = self.data["models"][model_id]
                m_info["used"] += 1
                m_info["last_used"] = time.strftime("%Y-%m-%d %H:%M:%S")
                # If reached limit, mark exhausted
                if m_info["used"] >= m_info["limit"]:
                    m_info["status"] = "exhausted"
                else:
                    m_info["status"] = "ready"
                    m_info["rate_limited_until"] = None
                self._save()

    def record_error(self, model_id, error_msg="Error"):
        with self._lock:
            self.check_date_reset()
            self._check_expired_rate_limits()
            if model_id in self.data["models"]:
                m_info = self.data["models"][model_id]
                err_str = str(error_msg)
                m_info["last_error"] = err_str[:200]
                
                # Check if truly daily quota exhausted (1500 used)
                if m_info["used"] >= m_info["limit"]:
                    m_info["status"] = "exhausted"
                    print(f"[QuotaTracker] Model [{model_id}] marked DAILY EXHAUSTED: {error_msg}")
                else:
                    # 429 when used < 1500 is a temporary 1-minute RPM burst limit (15 requests/min)
                    m_info["status"] = "rate_limited"
                    m_info["rate_limited_until"] = time.time() + 60
                    print(f"[QuotaTracker] Model [{model_id}] hit RPM limit -> marked RATE_LIMITED for 60s: {error_msg}")
                self._save()

    def record_exhausted(self, model_id, error_msg="Quota exhausted"):
        self.record_error(model_id, error_msg)

    def record_rate_limited(self, model_id, error_msg="RPM limit reached"):
        self.record_error(model_id, error_msg)

    def get_candidate_models(self, preferred_model=None):
        """
        Returns ordered list of models that are ready, followed by rate_limited, then exhausted.
        If preferred_model is provided and not 'auto', prioritizes that specific model first.
        """
        with self._lock:
            self.check_date_reset()
            self._check_expired_rate_limits()
            ready = []
            rate_limited = []
            exhausted = []

            # Determine base list
            all_defs = list(CASCADE_MODELS_DEF)
            if preferred_model and preferred_model != "auto":
                # Find matching model and put at front of list
                pref_obj = next((m for m in all_defs if m["id"] == preferred_model), None)
                if pref_obj:
                    all_defs.remove(pref_obj)
                    all_defs.insert(0, pref_obj)
                elif preferred_model.startswith("gemini"):
                    all_defs.insert(0, {"id": preferred_model, "daily_limit": 1500})

            for m in all_defs:
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
            return ordered if ordered else [m["id"] for m in all_defs]

    def get_status(self):
        with self._lock:
            self.check_date_reset()
            self._check_expired_rate_limits()
            models_list = []
            total_used = 0
            total_limit = 0
            active_model = None
            now = time.time()

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

                rl_until = m_data.get("rate_limited_until", 0)
                secs_left = max(0, int(rl_until - now)) if (status == "rate_limited" and rl_until) else 0

                models_list.append({
                    "id": mid,
                    "name": m["name"],
                    "tier": m["tier"],
                    "avg_speed": m.get("avg_speed", "~1s"),
                    "desc": m.get("desc", ""),
                    "used": used,
                    "limit": limit,
                    "remaining": remaining,
                    "status": status,
                    "rate_limit_secs": secs_left,
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
