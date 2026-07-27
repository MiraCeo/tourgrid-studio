from __future__ import annotations

import base64
import binascii
import hashlib
from typing import Annotated

from fastapi import APIRouter, Path, Request

from backend.palette import load_palette

from .errors import ApiError
from .models import SaveWorkRequest, WorkResponse
from .work_store import (
    SHARE_CODE_ALPHABET,
    WorkRecord,
    WorkStore,
    WorkStoreUnavailable,
)


WORK_SCHEMA_VERSION = 1
PACKED_PIXEL_BYTES = 432
SHARE_CODE_PATTERN = rf"^[{SHARE_CODE_ALPHABET}]{{12}}$"


def decode_pixel_payload(encoded: str) -> bytes:
    try:
        payload = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ApiError(
            422,
            "invalid_pixel_data",
            "Pixel data must be valid Base64.",
        ) from error
    if len(payload) != PACKED_PIXEL_BYTES:
        raise ApiError(
            422,
            "invalid_pixel_data_length",
            f"Packed pixel data must be exactly {PACKED_PIXEL_BYTES} bytes.",
        )
    return payload


def content_digest(
    *,
    schema_version: int,
    palette_id: str,
    palette_version: int,
    pixel_data: bytes,
) -> bytes:
    canonical = (
        b"tourgrid-work\0"
        + schema_version.to_bytes(2, "big")
        + palette_id.encode("ascii")
        + b"\0"
        + palette_version.to_bytes(2, "big")
        + pixel_data
    )
    return hashlib.sha256(canonical).digest()


def work_response(record: WorkRecord) -> WorkResponse:
    return WorkResponse(
        code=record.code,
        schema_version=record.schema_version,
        palette_id=record.palette_id,
        palette_version=record.palette_version,
        pixels=base64.b64encode(record.pixel_data).decode("ascii"),
        author_name=record.author_name,
        title=record.title,
        view_count=record.view_count,
        created_at=record.created_at,
    )


def create_works_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/works", tags=["works"])

    @router.post(
        "",
        response_model=WorkResponse,
        status_code=201,
    )
    async def save_work(
        request: Request,
        payload: SaveWorkRequest,
    ) -> WorkResponse:
        if payload.schema_version != WORK_SCHEMA_VERSION:
            raise ApiError(
                409,
                "work_schema_version_mismatch",
                f"Server supports work schema version {WORK_SCHEMA_VERSION}.",
            )

        try:
            palette = load_palette(payload.palette_id)
        except (FileNotFoundError, ValueError) as error:
            raise ApiError(
                404,
                "palette_not_found",
                "Palette does not exist.",
            ) from error
        if palette.version != payload.palette_version:
            raise ApiError(
                409,
                "palette_version_mismatch",
                (
                    f"Requested palette version {payload.palette_version}; "
                    f"server provides {palette.version}."
                ),
            )
        if len(palette.colors) != 64:
            raise ApiError(
                409,
                "palette_not_shareable",
                "Shared works require a 64-color palette.",
            )

        pixel_data = decode_pixel_payload(payload.pixels)
        digest = content_digest(
            schema_version=payload.schema_version,
            palette_id=payload.palette_id,
            palette_version=payload.palette_version,
            pixel_data=pixel_data,
        )
        store: WorkStore = request.app.state.work_store
        try:
            record = await store.save(
                schema_version=payload.schema_version,
                palette_id=payload.palette_id,
                palette_version=payload.palette_version,
                pixel_data=pixel_data,
                content_hash=digest,
                author_name=payload.author_name,
                title=payload.title,
            )
        except WorkStoreUnavailable as error:
            raise ApiError(
                503,
                "work_storage_unavailable",
                "Work sharing storage is temporarily unavailable.",
            ) from error
        return work_response(record)

    @router.get(
        "/{code}",
        response_model=WorkResponse,
    )
    async def get_work(
        request: Request,
        code: Annotated[str, Path(pattern=SHARE_CODE_PATTERN)],
    ) -> WorkResponse:
        store: WorkStore = request.app.state.work_store
        try:
            record = await store.get_and_increment_views(code)
        except WorkStoreUnavailable as error:
            raise ApiError(
                503,
                "work_storage_unavailable",
                "Work sharing storage is temporarily unavailable.",
            ) from error
        if record is None:
            raise ApiError(404, "work_not_found", "Shared work does not exist.")
        return work_response(record)

    return router
