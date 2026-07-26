from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class HealthResponse(ApiModel):
    status: str
    converter_version: str
    default_palette_id: str


class PaletteSummary(ApiModel):
    id: str
    name: str
    version: int
    status: str
    color_count: int


class PaletteColorResponse(ApiModel):
    id: str
    name: str
    rgb: tuple[int, int, int]
    hex: str
    confirmed: bool


class PaletteDetail(PaletteSummary):
    description: str
    sampled_color_count: int
    predicted_color_count: int
    colors: list[PaletteColorResponse]


class ConvertResponse(ApiModel):
    width: int
    height: int
    palette_id: str
    palette_version: int
    converter_version: str
    used_colors: int
    used_color_ids: list[str]
    pixels: list[list[str | None]]
    hex_pixels: list[list[str | None]]
    preview_url: str
    mapping_mode: str
    learned_colors: int | None = None
    cleanup_changes: int = 0


class ErrorDetail(ApiModel):
    code: str
    message: str
    details: list[dict[str, object]] | None = None


class ErrorResponse(ApiModel):
    error: ErrorDetail


class ImageMetadata(ApiModel):
    format: str = Field(description="Decoded Pillow image format.")
    width: int
    height: int
    frames: int
