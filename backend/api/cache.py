from __future__ import annotations

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass


@dataclass(frozen=True)
class CachedPreview:
    content: bytes
    expires_at: float


class PreviewCache:
    def __init__(self, *, max_entries: int, ttl_seconds: int) -> None:
        if max_entries < 1 or ttl_seconds < 1:
            raise ValueError("Preview cache limits must be positive")
        self._max_entries = max_entries
        self._ttl_seconds = ttl_seconds
        self._items: OrderedDict[str, CachedPreview] = OrderedDict()
        self._lock = threading.Lock()

    @property
    def ttl_seconds(self) -> int:
        return self._ttl_seconds

    def put(self, result_id: str, content: bytes) -> None:
        now = time.monotonic()
        with self._lock:
            self._prune(now)
            self._items[result_id] = CachedPreview(
                content=content,
                expires_at=now + self._ttl_seconds,
            )
            self._items.move_to_end(result_id)
            while len(self._items) > self._max_entries:
                self._items.popitem(last=False)

    def get(self, result_id: str) -> bytes | None:
        now = time.monotonic()
        with self._lock:
            self._prune(now)
            preview = self._items.get(result_id)
            if preview is None:
                return None
            self._items.move_to_end(result_id)
            return preview.content

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def _prune(self, now: float) -> None:
        expired = [
            result_id
            for result_id, preview in self._items.items()
            if preview.expires_at <= now
        ]
        for result_id in expired:
            self._items.pop(result_id, None)
