from __future__ import annotations

import re
import asyncio
from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.api.work_store import (
    SHARE_CODE_ALPHABET,
    SHARE_CODE_LENGTH,
    InMemoryWorkStore,
    generate_share_code,
)
from backend.api.works import content_digest, decode_pixel_payload


def test_share_code_is_12_character_base58() -> None:
    code = generate_share_code()

    assert len(code) == SHARE_CODE_LENGTH
    assert set(code) <= set(SHARE_CODE_ALPHABET)
    assert re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{12}", code)


def test_content_digest_includes_palette_and_schema_versions() -> None:
    pixels = bytes(432)
    baseline = content_digest(
        schema_version=1,
        palette_id="natural-64-v1",
        palette_version=1,
        pixel_data=pixels,
    )

    assert len(baseline) == 32
    assert baseline != content_digest(
        schema_version=1,
        palette_id="natural-64-v1",
        palette_version=2,
        pixel_data=pixels,
    )
    assert baseline != content_digest(
        schema_version=2,
        palette_id="natural-64-v1",
        palette_version=1,
        pixel_data=pixels,
    )


def test_packed_pixel_payload_must_be_exactly_432_bytes() -> None:
    import base64

    encoded = base64.b64encode(bytes(432)).decode("ascii")
    assert decode_pixel_payload(encoded) == bytes(432)

    with pytest.raises(Exception):
        decode_pixel_payload(base64.b64encode(bytes(431)).decode("ascii"))


def test_memory_store_deduplicates_and_increments_views() -> None:
    store = InMemoryWorkStore()
    values = {
        "schema_version": 1,
        "palette_id": "natural-64-v1",
        "palette_version": 1,
        "pixel_data": bytes(432),
        "content_hash": bytes(32),
        "author_name": None,
        "title": None,
    }

    async def exercise_store():
        first = await store.save(**values)
        duplicate = await store.save(**values)
        opened = await store.get_and_increment_views(first.code)
        return first, duplicate, opened

    with ThreadPoolExecutor(max_workers=1) as pool:
        first, duplicate, opened = pool.submit(
            asyncio.run,
            exercise_store(),
        ).result()

    assert duplicate.code == first.code
    assert opened is not None
    assert opened.view_count == 1
