from __future__ import annotations

from backend.palette import load_palette
from backend.palette_migration import (
    build_index_mapping,
    convert_pixels,
    pack_indices,
    unpack_indices,
)


def test_palette_migration_maps_legacy_white_to_official_white() -> None:
    source = load_palette("natural-64-v2")
    target = load_palette("official-40-v1")
    mapping = build_index_mapping(source, target)

    legacy_white_index = next(
        index for index, color in enumerate(source.colors)
        if color.hex == "#FFFFFF"
    )
    official_white_index = next(
        index for index, color in enumerate(target.colors)
        if color.hex == "#FFFFFF"
    )
    assert mapping[legacy_white_index] == official_white_index
    assert all(0 <= index < len(target.colors) for index in mapping)


def test_palette_migration_preserves_the_432_byte_codec_shape() -> None:
    source = load_palette("natural-64-v2")
    target = load_palette("official-40-v1")
    mapping = build_index_mapping(source, target)
    source_indices = [index % 64 for index in range(24 * 24)]

    converted = convert_pixels(pack_indices(source_indices), mapping)

    assert len(converted) == 432
    assert unpack_indices(converted) == [mapping[index] for index in source_indices]
