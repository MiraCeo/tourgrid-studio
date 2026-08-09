from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    IPvAnyAddress,
    field_validator,
)


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class HealthResponse(ApiModel):
    status: str
    app_version: str
    default_palette_id: str


class ReadinessResponse(ApiModel):
    status: str
    database: str
    shared_state: str


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
    author_name: str | None = Field(default=None, max_length=15)
    title: str | None = Field(default=None, max_length=15)

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


class BanClientRequest(ApiModel):
    client_ip: IPvAnyAddress = Field(validation_alias="clientIp")
    reason: str | None = Field(default=None, max_length=200)
    ttl_seconds: int | None = Field(
        default=None,
        ge=60,
        le=2_592_000,
    )


class ModerationResponse(ApiModel):
    status: str
    code: str | None = None
    client_ip: str | None = None
    scope: str | None = None


class AdminSessionResponse(ApiModel):
    authenticated: bool


class ModerationReasonRequest(ApiModel):
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason", mode="before")
    @classmethod
    def normalize_reason(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return value.strip()


class RestoreWorkRequest(ApiModel):
    reason: str | None = Field(default=None, max_length=500)

    @field_validator("reason", mode="before")
    @classmethod
    def normalize_restore_reason(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        return normalized or None


class PurgeWorkRequest(ModerationReasonRequest):
    confirmation_code: str = Field(
        min_length=12,
        max_length=12,
        pattern=r"^[1-9A-HJ-NP-Za-km-z]{12}$",
    )


class AdminWorkResponse(ApiModel):
    code: str
    schema_version: int
    palette_id: str
    palette_version: int
    pixels: str | None = None
    author_name: str | None = None
    title: str | None = None
    view_count: int
    created_at: datetime
    moderation_status: Literal["active", "hidden", "purged"]
    moderated_at: datetime | None = None
    moderation_reason: str | None = None
    purged_at: datetime | None = None


class AdminWorkListResponse(ApiModel):
    works: list[AdminWorkResponse]
    next_cursor: int | None = None
    page: int | None = None
    page_size: int | None = None
    total_count: int | None = None
    total_pages: int | None = None


class AdminWorkBatchRequest(ApiModel):
    codes: list[
        Annotated[
            str,
            Field(
                min_length=12,
                max_length=12,
                pattern=r"^[1-9A-HJ-NP-Za-km-z]{12}$",
            ),
        ]
    ] = Field(min_length=1, max_length=50)

    @field_validator("codes")
    @classmethod
    def require_unique_codes(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("codes must not contain duplicates")
        return value


class AdminWorkBatchResponse(ApiModel):
    works: list[AdminWorkResponse]


class ModerationEventResponse(ApiModel):
    event_id: int
    action: str
    target_type: str
    target_value: str
    reason: str | None = None
    request_id: str | None = None
    administrator_ip: str | None = None
    created_at: datetime


class ModerationEventListResponse(ApiModel):
    events: list[ModerationEventResponse]
    next_cursor: int | None = None


class ErrorDetail(ApiModel):
    code: str
    message: str
    details: list[dict[str, object]] | None = None


class ErrorResponse(ApiModel):
    error: ErrorDetail
