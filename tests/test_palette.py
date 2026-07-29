from __future__ import annotations

import json

import pytest

from backend.palette import DEFAULT_PALETTE_ID, PALETTES_DIR, list_palettes, load_palette


def test_default_palette_has_expected_version_and_counts() -> None:
    palette = load_palette()

    assert palette.palette_id == "natural-64-v2"
    assert palette.version == 2
    assert palette.status == "provisional"
    assert len(palette.colors) == 64
    assert palette.sampled_color_count == 32
    assert palette.predicted_color_count == 32
    assert sum(color.confirmed for color in palette.colors) == 32


def test_default_palette_colors_are_unique_and_consistent() -> None:
    palette = load_palette()

    assert len({color.color_id for color in palette.colors}) == 64
    assert len({color.rgb for color in palette.colors}) == 64
    assert len({color.hex for color in palette.colors}) == 64

    for color in palette.colors:
        assert color.hex == "#{:02X}{:02X}{:02X}".format(*color.rgb)


def test_default_palette_preserves_known_boundary_colors() -> None:
    palette = load_palette()

    assert palette.colors[0].color_id == "C15"
    assert palette.colors[0].rgb == (36, 36, 36)
    assert palette.colors[-1].color_id == "C20"
    assert palette.colors[-1].rgb == (186, 163, 212)


def test_palette_listing_loads_the_default_palette() -> None:
    assert [palette.palette_id for palette in list_palettes()] == [DEFAULT_PALETTE_ID]
    assert (PALETTES_DIR / "archive" / "natural-64-v1.json").is_file()
    with pytest.raises(FileNotFoundError, match="Palette does not exist"):
        load_palette("natural-64-v1")


def test_palette_loader_rejects_path_traversal() -> None:
    with pytest.raises(ValueError, match="Invalid palette id"):
        load_palette("../natural-64-v2")


def test_palette_document_is_valid_utf8_json() -> None:
    path = PALETTES_DIR / f"{DEFAULT_PALETTE_ID}.json"
    with path.open("r", encoding="utf-8") as handle:
        document = json.load(handle)

    assert document["id"] == DEFAULT_PALETTE_ID
