from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class HealthResponse(ApiModel):
    status: str
    app_version: str
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


class SaveWorkRequest(ApiModel):
    schema_version: int = Field(ge=1, le=255)
    palette_id: str = Field(
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9][a-z0-9-]*$",
    )
    palette_version: int = Field(ge=1, le=32767)
    pixels: str = Field(
        min_length=576,
        max_length=576,
        pattern=r"^[A-Za-z0-9+/]{576}$",
    )
    author_name: str | None = Field(default=None, max_length=10)
    title: str | None = Field(default=None, max_length=10)

    @field_validator("author_name", "title", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        return normalized or None


class WorkResponse(ApiModel):
    code: str
    schema_version: int
    palette_id: str
    palette_version: int
    pixels: str
    author_name: str | None = None
    title: str | None = None
    view_count: int
    created_at: datetime


class ErrorDetail(ApiModel):
    code: str
    message: str
    details: list[dict[str, object]] | None = None


class ErrorResponse(ApiModel):
    error: ErrorDetail
