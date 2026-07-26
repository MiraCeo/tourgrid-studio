from __future__ import annotations

from unittest.mock import patch

from backend.api.cache import PreviewCache


def test_preview_cache_evicts_oldest_entry_at_capacity() -> None:
    cache = PreviewCache(max_entries=2, ttl_seconds=60)
    cache.put("first", b"1")
    cache.put("second", b"2")
    cache.put("third", b"3")

    assert cache.get("first") is None
    assert cache.get("second") == b"2"
    assert cache.get("third") == b"3"


def test_preview_cache_expires_entries() -> None:
    cache = PreviewCache(max_entries=2, ttl_seconds=10)

    with patch("backend.api.cache.time.monotonic", return_value=100.0):
        cache.put("preview", b"png")
    with patch("backend.api.cache.time.monotonic", return_value=109.9):
        assert cache.get("preview") == b"png"
    with patch("backend.api.cache.time.monotonic", return_value=110.0):
        assert cache.get("preview") is None
