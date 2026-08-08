from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PALETTES_DIR = PROJECT_ROOT / "palettes"
DEFAULT_PALETTE_ID = "official-40-v1"
HEX_PATTERN = re.compile(r"^#[0-9A-F]{6}$")


@dataclass(frozen=True)
class PaletteColor:
    color_id: str
    name: str
    rgb: tuple[int, int, int]
    hex: str
    confirmed: bool


@dataclass(frozen=True)
class PaletteDefinition:
    palette_id: str
    name: str
    version: int
    status: str
    description: str
    sampled_color_count: int
    predicted_color_count: int
    colors: tuple[PaletteColor, ...]
    source_path: Path

    @property
    def rgb_colors(self) -> list[tuple[int, int, int]]:
        return [color.rgb for color in self.colors]

    @property
    def hex_colors(self) -> list[str]:
        return [color.hex for color in self.colors]

    @property
    def rgb_to_id(self) -> dict[tuple[int, int, int], str]:
        return {color.rgb: color.color_id for color in self.colors}

    @property
    def rgb_to_hex(self) -> dict[tuple[int, int, int], str]:
        return {color.rgb: color.hex for color in self.colors}


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _parse_color(raw: Any, *, index: int) -> PaletteColor:
    _require(isinstance(raw, dict), f"colors[{index}] must be an object")

    color_id = raw.get("id")
    name = raw.get("name")
    rgb = raw.get("rgb")
    hex_value = raw.get("hex")
    confirmed = raw.get("confirmed")

    _require(isinstance(color_id, str) and color_id, f"colors[{index}].id is required")
    _require(isinstance(name, str) and name, f"colors[{index}].name is required")
    _require(
        isinstance(rgb, list)
        and len(rgb) == 3
        and all(isinstance(channel, int) and 0 <= channel <= 255 for channel in rgb),
        f"colors[{index}].rgb must contain three integers from 0 to 255",
    )
    _require(
        isinstance(hex_value, str) and HEX_PATTERN.fullmatch(hex_value) is not None,
        f"colors[{index}].hex must use uppercase #RRGGBB format",
    )
    _require(isinstance(confirmed, bool), f"colors[{index}].confirmed must be boolean")

    rgb_tuple = tuple(rgb)
    expected_hex = "#{:02X}{:02X}{:02X}".format(*rgb_tuple)
    _require(
        hex_value == expected_hex,
        f"colors[{index}] RGB {rgb_tuple} does not match {hex_value}",
    )

    return PaletteColor(
        color_id=color_id,
        name=name,
        rgb=rgb_tuple,
        hex=hex_value,
        confirmed=confirmed,
    )


def _parse_palette(raw: Any, source_path: Path) -> PaletteDefinition:
    _require(isinstance(raw, dict), "Palette document must be an object")

    palette_id = raw.get("id")
    name = raw.get("name")
    version = raw.get("version")
    status = raw.get("status")
    description = raw.get("description")
    source = raw.get("source")
    raw_colors = raw.get("colors")

    _require(isinstance(palette_id, str) and palette_id, "Palette id is required")
    _require(isinstance(name, str) and name, "Palette name is required")
    _require(isinstance(version, int) and version >= 1, "Palette version must be positive")
    _require(isinstance(status, str) and status, "Palette status is required")
    _require(isinstance(description, str), "Palette description must be a string")
    _require(isinstance(source, dict), "Palette source must be an object")
    _require(isinstance(raw_colors, list) and raw_colors, "Palette colors must be a list")

    sampled_count = source.get("sampledColorCount")
    predicted_count = source.get("predictedColorCount")
    _require(
        isinstance(sampled_count, int) and sampled_count >= 0,
        "sampledColorCount must be a non-negative integer",
    )
    _require(
        isinstance(predicted_count, int) and predicted_count >= 0,
        "predictedColorCount must be a non-negative integer",
    )

    colors = tuple(_parse_color(color, index=index) for index, color in enumerate(raw_colors))
    ids = [color.color_id for color in colors]
    rgbs = [color.rgb for color in colors]
    hex_values = [color.hex for color in colors]

    _require(len(ids) == len(set(ids)), "Palette color ids must be unique")
    _require(len(rgbs) == len(set(rgbs)), "Palette RGB colors must be unique")
    _require(len(hex_values) == len(set(hex_values)), "Palette hex colors must be unique")
    _require(
        sampled_count + predicted_count == len(colors),
        "Palette source counts must add up to the number of colors",
    )
    _require(
        sum(color.confirmed for color in colors) == sampled_count,
        "Confirmed color count must match sampledColorCount",
    )

    return PaletteDefinition(
        palette_id=palette_id,
        name=name,
        version=version,
        status=status,
        description=description,
        sampled_color_count=sampled_count,
        predicted_color_count=predicted_count,
        colors=colors,
        source_path=source_path,
    )


@lru_cache(maxsize=16)
def load_palette(palette_id: str = DEFAULT_PALETTE_ID) -> PaletteDefinition:
    if not palette_id or Path(palette_id).name != palette_id:
        raise ValueError(f"Invalid palette id: {palette_id!r}")

    path = PALETTES_DIR / f"{palette_id}.json"
    if not path.is_file():
        raise FileNotFoundError(f"Palette does not exist: {palette_id}")

    with path.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)

    palette = _parse_palette(raw, path)
    if palette.palette_id != palette_id:
        raise ValueError(
            f"Palette id {palette.palette_id!r} does not match filename {path.name!r}"
        )
    return palette


def list_palettes() -> list[PaletteDefinition]:
    palettes = []
    for path in sorted(PALETTES_DIR.glob("*.json")):
        palettes.append(load_palette(path.stem))
    return palettes
