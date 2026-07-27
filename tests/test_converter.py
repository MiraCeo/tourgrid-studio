from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from backend import CONVERTER_VERSION
from backend.cli import build_parser
from backend.converter import (
    ConversionOptions,
    _opaque_rgb_fit_source,
    convert_array,
    crop_to_aspect,
    save_conversion,
)
from backend.palette import load_palette


def make_source(height: int = 72, width: int = 96) -> np.ndarray:
    y, x = np.mgrid[0:height, 0:width]
    source = np.empty((height, width, 3), dtype=np.uint8)
    source[..., 0] = (x * 255 // max(width - 1, 1)).astype(np.uint8)
    source[..., 1] = (y * 255 // max(height - 1, 1)).astype(np.uint8)
    source[..., 2] = ((x + y) * 255 // max(width + height - 2, 1)).astype(np.uint8)
    return source


def test_conversion_option_defaults_match_approved_baseline() -> None:
    options = ConversionOptions()

    assert (options.width, options.height) == (24, 24)
    assert options.fit == "crop"
    assert options.dither == "none"
    assert options.sobel == 3
    assert options.depth == 1
    assert options.svd is True
    assert options.mapping_mode == "direct"


def test_cli_defaults_match_approved_baseline() -> None:
    args = build_parser().parse_args(["input.png"])

    assert (args.width, args.height) == (24, 24)
    assert args.fit == "crop"
    assert args.dither == "none"
    assert args.sobel == 3
    assert args.depth == 1
    assert args.no_svd is False
    assert args.mapping_mode == "direct"
    assert args.palette_id == "natural-64-v1"


def test_crop_to_aspect_centers_landscape_and_portrait_images() -> None:
    landscape = Image.new("RGB", (100, 60))
    portrait = Image.new("RGB", (60, 100))

    assert crop_to_aspect(landscape, 24, 24).size == (60, 60)
    assert crop_to_aspect(portrait, 24, 24).size == (60, 60)


def test_transparent_fit_source_contains_only_visible_rgb_samples() -> None:
    source = np.array(
        [
            [[255, 0, 0, 255], [1, 2, 3, 0]],
            [[0, 255, 0, 128], [4, 5, 6, 0]],
        ],
        dtype=np.uint8,
    )

    fit_source = _opaque_rgb_fit_source(source, min_samples=4)
    colors = {tuple(map(int, pixel)) for pixel in fit_source.reshape(-1, 3)}

    assert fit_source.shape == (3, 3, 3)
    assert colors == {(255, 0, 0)}


@pytest.mark.integration
@pytest.mark.parametrize("opaque_pixel", [None, (16, 16)])
def test_transparent_edge_cases_convert_without_palette_leaks(
    opaque_pixel: tuple[int, int] | None,
) -> None:
    source = np.zeros((32, 32, 4), dtype=np.uint8)
    if opaque_pixel is not None:
        source[opaque_pixel] = [240, 20, 20, 255]

    result = convert_array(source, options=ConversionOptions())

    assert result.image.shape == (24, 24, 4)
    assert set(map(int, result.image[..., 3].reshape(-1))) <= {0, 255}
    assert result.used_colors == (0 if opaque_pixel is None else 1)


@pytest.mark.integration
def test_direct_conversion_is_strict_and_palette_limited() -> None:
    palette = load_palette()
    result = convert_array(
        make_source(),
        options=ConversionOptions(svd=False),
        palette=palette,
    )

    assert result.image.shape == (24, 24, 3)
    assert result.width == 24
    assert result.height == 24
    assert result.palette_id == "natural-64-v1"
    assert result.palette_version == 1
    assert result.converter_version == CONVERTER_VERSION
    assert result.mapping_mode == "direct"
    assert len(result.pixels) == 24
    assert all(len(row) == 24 for row in result.pixels)
    assert len(result.hex_pixels) == 24
    assert all(len(row) == 24 for row in result.hex_pixels)

    allowed = set(palette.rgb_colors)
    used = {tuple(map(int, pixel)) for pixel in result.image.reshape(-1, 3)}
    assert used <= allowed
    assert result.used_colors == len(used)


@pytest.mark.integration
def test_direct_conversion_is_stable_for_same_input() -> None:
    source = make_source(60, 80)
    options = ConversionOptions()

    first = convert_array(source, options=options)
    second = convert_array(source, options=options)

    np.testing.assert_array_equal(first.image, second.image)
    assert first.pixels == second.pixels
    assert first.hex_pixels == second.hex_pixels


@pytest.mark.integration
def test_save_conversion_writes_raw_and_nearest_neighbor_preview(tmp_path) -> None:
    result = convert_array(
        make_source(),
        options=ConversionOptions(svd=False),
    )
    output = tmp_path / "pixel.png"
    preview = tmp_path / "preview.png"

    save_conversion(result, output, preview, preview_scale=5)

    with Image.open(output) as pixel_image:
        assert pixel_image.size == (24, 24)
        output_pixels = np.asarray(pixel_image.convert("RGB"))
    with Image.open(preview) as preview_image:
        assert preview_image.size == (120, 120)
        preview_pixels = np.asarray(preview_image.convert("RGB"))

    np.testing.assert_array_equal(preview_pixels[::5, ::5], output_pixels)
