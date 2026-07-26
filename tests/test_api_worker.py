from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image

from backend.api.errors import ConversionTimedOut
from backend.api.worker import run_conversion_with_timeout
from backend.converter import ConversionOptions


def test_worker_process_is_terminated_on_timeout() -> None:
    image = Image.new("RGB", (32, 32), (100, 120, 140))
    buffer = BytesIO()
    image.save(buffer, "PNG")

    with pytest.raises(ConversionTimedOut):
        run_conversion_with_timeout(
            buffer.getvalue(),
            ConversionOptions(svd=False),
            "natural-64-v1",
            0.001,
            2,
        )


@pytest.mark.integration
def test_worker_process_returns_serializable_conversion() -> None:
    image = Image.new("RGB", (48, 48), (100, 120, 140))
    buffer = BytesIO()
    image.save(buffer, "PNG")

    result = run_conversion_with_timeout(
        buffer.getvalue(),
        ConversionOptions(svd=False),
        "natural-64-v1",
        30,
        2,
    )

    assert result["width"] == 24
    assert result["height"] == 24
    assert result["palette_id"] == "natural-64-v1"
    assert len(result["pixels"]) == 24
    assert len(result["hex_pixels"]) == 24
    assert result["preview_png"].startswith(b"\x89PNG\r\n\x1a\n")
