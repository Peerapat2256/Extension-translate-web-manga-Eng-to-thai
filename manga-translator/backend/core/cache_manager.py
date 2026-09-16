from collections import OrderedDict
import threading

class LimitedCache(OrderedDict):
    """Thread-safe LRU Cache with maximum capacity"""
    def __init__(self, maxsize=150, *args, **kwargs):
        self.maxsize = maxsize
        self._lock = threading.RLock()
        super().__init__(*args, **kwargs)

    def __getitem__(self, key):
        with self._lock:
            value = super().__getitem__(key)
            super().move_to_end(key)
            return value

    def get(self, key, default=None):
        with self._lock:
            if super().__contains__(key):
                value = super().__getitem__(key)
                super().move_to_end(key)
                return value
            return default

    def __contains__(self, key):
        with self._lock:
            return super().__contains__(key)

    def __setitem__(self, key, value):
        with self._lock:
            if super().__contains__(key):
                super().move_to_end(key)
            super().__setitem__(key, value)
            if len(self) > self.maxsize:
                super().popitem(last=False)

# Global instances
image_cache = LimitedCache(maxsize=150)
text_cache = LimitedCache(maxsize=2000)
