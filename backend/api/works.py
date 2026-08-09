from __future__ import annotations

import base64
import binascii
import re
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Path, Request, Response

from backend.palette import DEFAULT_PALETTE_ID, load_palette

from .errors import ApiError
from .models import LikeWorkResponse, SaveWorkRequest, WorkResponse
from .shared_state import SharedState, SharedStateUnavailable
from .work_store import (
    SHARE_CODE_ALPHABET,
    WorkRecord,
    WorkModerated,
    WorkStore,
    WorkStoreUnavailable,
    canonical_content_digest,
)


WORK_SCHEMA_VERSION = 1
PACKED_PIXEL_BYTES = 432
SHARE_CODE_PATTERN = rf"^[{SHARE_CODE_ALPHABET}]{{12}}$"
VIEWER_COOKIE = "tourgrid_viewer"
VIEWER_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


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


def validate_pixel_indices(payload: bytes, color_count: int) -> None:
    for offset in range(0, len(payload), 3):
        value = int.from_bytes(payload[offset : offset + 3], "big")
        indices = (
            (value >> 18) & 0x3F,
            (value >> 12) & 0x3F,
            (value >> 6) & 0x3F,
            value & 0x3F,
        )
        if any(index >= color_count for index in indices):
            raise ApiError(
                422,
                "invalid_palette_index",
                "Pixel data contains an index outside the selected palette.",
            )


def content_digest(
    *,
    schema_version: int,
    palette_id: str,
    palette_version: int,
    pixel_data: bytes,
) -> bytes:
    return canonical_content_digest(
        schema_version=schema_version,
        palette_id=palette_id,
        palette_version=palette_version,
        pixel_data=pixel_data,
    )


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


def viewer_id_for_request(request: Request, response: Response) -> str:
    viewer_id = request.cookies.get(VIEWER_COOKIE, "")
    if VIEWER_ID_PATTERN.fullmatch(viewer_id):
        return viewer_id
    viewer_id = uuid4().hex
    response.set_cookie(
        VIEWER_COOKIE,
        viewer_id,
        max_age=31_536_000,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
    )
    return viewer_id


async def unavailable_work_error(store: WorkStore, code: str) -> ApiError:
    state = await store.get_moderation_state(code)
    if state is None or state.status == "active":
        return ApiError(404, "work_not_found", "该作品不存在。")

    reason = state.reason or "未提供"
    if state.status == "hidden":
        return ApiError(
            404,
            "work_hidden",
            f"该作品已被隐藏。处理原因：{reason}。",
        )
    if state.status == "purged":
        return ApiError(
            404,
            "work_deleted",
            f"该作品已被删除。处理原因：{reason}。",
        )
    return ApiError(404, "work_not_found", "该作品不存在。")


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

        if payload.palette_id != DEFAULT_PALETTE_ID:
            raise ApiError(
                409,
                "palette_not_shareable",
                f"New shared works must use {DEFAULT_PALETTE_ID}.",
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
        if not 1 <= len(palette.colors) <= 64:
            raise ApiError(
                409,
                "palette_not_shareable",
                "Shared works require a palette with at most 64 colors.",
            )

        pixel_data = decode_pixel_payload(payload.pixels)
        validate_pixel_indices(pixel_data, len(palette.colors))
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
        except WorkModerated as error:
            raise ApiError(
                403,
                "work_blocked",
                "This work was removed and cannot be republished.",
            ) from error
        return work_response(record)

    @router.get(
        "/{code}",
        response_model=WorkResponse,
    )
    async def get_work(
        request: Request,
        response: Response,
        code: Annotated[str, Path(pattern=SHARE_CODE_PATTERN)],
    ) -> WorkResponse:
        store: WorkStore = request.app.state.work_store
        shared_state: SharedState = request.app.state.shared_state
        try:
            record = await store.get(code)
            if record is None:
                raise await unavailable_work_error(store, code)

            viewer_id = viewer_id_for_request(request, response)
            should_count = await shared_state.claim_view(
                code,
                viewer_id,
                request.app.state.settings.view_dedupe_seconds,
            )
            if should_count:
                record = await store.get_and_increment_views(code)
                if record is None:
                    raise await unavailable_work_error(store, code)
        except WorkStoreUnavailable as error:
            raise ApiError(
                503,
                "work_storage_unavailable",
                "Work sharing storage is temporarily unavailable.",
            ) from error
        except SharedStateUnavailable as error:
            raise ApiError(
                503,
                "shared_state_unavailable",
                "Shared view tracking is temporarily unavailable.",
            ) from error
        return work_response(record)

    @router.post(
        "/{code}/like",
        response_model=LikeWorkResponse,
    )
    async def like_work(
        request: Request,
        response: Response,
        code: Annotated[str, Path(pattern=SHARE_CODE_PATTERN)],
    ) -> LikeWorkResponse:
        store: WorkStore = request.app.state.work_store
        shared_state: SharedState = request.app.state.shared_state
        try:
            record = await store.get(code)
            if record is None:
                raise await unavailable_work_error(store, code)
            viewer_id = viewer_id_for_request(request, response)
            counted = await shared_state.claim_like(
                code,
                viewer_id,
                request.app.state.settings.view_dedupe_seconds,
            )
            if counted:
                record = await store.get_and_increment_views(code)
                if record is None:
                    raise await unavailable_work_error(store, code)
        except WorkStoreUnavailable as error:
            raise ApiError(
                503,
                "work_storage_unavailable",
                "Work sharing storage is temporarily unavailable.",
            ) from error
        except SharedStateUnavailable as error:
            raise ApiError(
                503,
                "shared_state_unavailable",
                "Shared like tracking is temporarily unavailable.",
            ) from error
        return LikeWorkResponse(
            code=record.code,
            counted=counted,
            view_count=record.view_count,
        )

    return router
