from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from backend.converter import ConversionOptions, convert_path
from backend.palette import load_palette


FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
BASELINE_DIR = FIXTURE_DIR / "baselines"
MANIFEST = json.loads((FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8"))
BASELINES = json.loads((BASELINE_DIR / "baseline.json").read_text(encoding="utf-8"))


def rgb_sha256(image: np.ndarray) -> str:
    return hashlib.sha256(np.asarray(image, dtype=np.uint8).tobytes()).hexdigest()


def fixture_names() -> list[str]:
    return [entry["file"] for entry in MANIFEST["fixtures"]]


def test_fixture_manifest_is_complete_and_reproducible() -> None:
    assert set(fixture_names()) == {
        "avatar-reference-synthetic.png",
        "transparent-subject.png",
        "landscape-scene.png",
        "portrait-scene.png",
        "large-pattern.png",
    }
    assert "not present" in MANIFEST["avatarNotice"]

    for entry in MANIFEST["fixtures"]:
        path = FIXTURE_DIR / entry["file"]
        assert path.is_file()
        assert hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"]
        with Image.open(path) as image:
            assert list(image.size) == entry["size"]
            assert image.mode == entry["mode"]


def test_visual_baseline_uses_approved_default_options() -> None:
    assert BASELINES["converterVersion"] == "1.1.0"
    assert BASELINES["converterOptions"] == {
        "width": 24,
        "height": 24,
        "fit": "crop",
        "dither": "none",
        "sobel": 3,
        "depth": 1,
        "svd": True,
        "mappingMode": "direct",
    }


@pytest.mark.integration
@pytest.mark.parametrize("fixture_name", fixture_names())
def test_fixture_matches_visual_baseline_and_palette(fixture_name: str) -> None:
    expected = BASELINES["baselines"][fixture_name]
    palette = load_palette()
    result = convert_path(FIXTURE_DIR / fixture_name, options=ConversionOptions())

    assert result.image.shape[:2] == (24, 24)
    assert result.image.shape[2] in (3, 4)
    rgb_result = result.image[..., :3]
    assert rgb_sha256(rgb_result) == expected["pixelSha256"]
    assert result.used_colors == expected["usedColors"]
    assert list(result.used_color_ids) == expected["usedColorIds"]

    allowed = set(palette.rgb_colors)
    if result.image.shape[2] == 4:
        opaque = result.image[..., 3] > 0
        palette_pixels = rgb_result[opaque]
    else:
        palette_pixels = rgb_result.reshape(-1, 3)
    actual = {tuple(map(int, pixel)) for pixel in palette_pixels.reshape(-1, 3)}
    assert actual <= allowed

    raw_path = FIXTURE_DIR / expected["raw"]
    preview_path = FIXTURE_DIR / expected["preview"]
    with Image.open(raw_path) as raw_image:
        raw_pixels = np.asarray(raw_image.convert("RGB"))
        assert raw_image.size == (24, 24)
    with Image.open(preview_path) as preview_image:
        preview_pixels = np.asarray(preview_image.convert("RGB"))
        assert preview_image.size == (240, 240)

    np.testing.assert_array_equal(raw_pixels, rgb_result)
    np.testing.assert_array_equal(preview_pixels[::10, ::10], raw_pixels)


def test_transparent_fixture_really_contains_alpha() -> None:
    with Image.open(FIXTURE_DIR / "transparent-subject.png") as image:
        alpha = np.asarray(image.getchannel("A"))

    assert alpha.min() == 0
    assert alpha.max() == 255


def test_landscape_portrait_and_large_fixture_dimensions() -> None:
    dimensions = {}
    for name in ("landscape-scene.png", "portrait-scene.png", "large-pattern.png"):
        with Image.open(FIXTURE_DIR / name) as image:
            dimensions[name] = image.size

    assert dimensions["landscape-scene.png"] == (360, 180)
    assert dimensions["portrait-scene.png"] == (180, 360)
    assert dimensions["large-pattern.png"] == (4096, 3072)
