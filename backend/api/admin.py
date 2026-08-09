from __future__ import annotations

import base64
import secrets
from ipaddress import ip_address
from typing import Annotated, Literal

from fastapi import APIRouter, Header, Path, Query, Request

from .errors import ApiError
from .models import (
    AdminSessionResponse,
    AdminWorkListResponse,
    AdminWorkResponse,
    BanClientRequest,
    ModerationEventListResponse,
    ModerationEventResponse,
    ModerationReasonRequest,
    ModerationResponse,
    PurgeWorkRequest,
    RestoreWorkRequest,
)
from .shared_state import SharedState, SharedStateUnavailable
from .work_store import (
    SHARE_CODE_ALPHABET,
    AdminWorkRecord,
    WorkStateConflict,
    WorkStore,
    WorkStoreUnavailable,
)


SHARE_CODE_PATTERN = rf"^[{SHARE_CODE_ALPHABET}]{{12}}$"
AuthorizationHeader = Annotated[str | None, Header()]


def _admin_auth_rate_limit_error(
    retry_after_seconds: int,
    limit: int,
) -> ApiError:
    return ApiError(
        429,
        "admin_auth_rate_limited",
        "Too many failed administrator authentication attempts. "
        "Please retry later.",
        headers={
            "Retry-After": str(retry_after_seconds),
            "X-RateLimit-Limit": str(limit),
            "X-RateLimit-Remaining": "0",
        },
    )


async def _require_admin(
    request: Request,
    authorization: str | None,
) -> None:
    configured = request.app.state.settings.admin_token
    if configured is None:
        raise ApiError(
            503,
            "admin_not_configured",
            "Administrative access is not configured.",
        )
    settings = request.app.state.settings
    client_ip = _administrator_ip(request)
    shared_state: SharedState = request.app.state.shared_state
    scheme, separator, supplied = (authorization or "").partition(" ")
    authenticated = (
        separator == " "
        and scheme.lower() == "bearer"
        and secrets.compare_digest(supplied, configured)
    )
    if authenticated:
        try:
            await shared_state.clear_admin_auth_failures(client_ip)
        except SharedStateUnavailable as error:
            raise ApiError(
                503,
                "shared_state_unavailable",
                "Shared abuse protection is temporarily unavailable.",
            ) from error
        return
    try:
        rate = await shared_state.check_admin_auth_failures(
            client_ip,
            limit=settings.admin_auth_failure_limit,
            window_seconds=settings.admin_auth_failure_window_seconds,
        )
    except SharedStateUnavailable as error:
        raise ApiError(
            503,
            "shared_state_unavailable",
            "Shared abuse protection is temporarily unavailable.",
        ) from error
    if not rate.allowed:
        raise _admin_auth_rate_limit_error(
            rate.retry_after_seconds,
            settings.admin_auth_failure_limit,
        )
    try:
        rate = await shared_state.record_admin_auth_failure(
            client_ip,
            limit=settings.admin_auth_failure_limit,
            window_seconds=settings.admin_auth_failure_window_seconds,
        )
    except SharedStateUnavailable as error:
        raise ApiError(
            503,
            "shared_state_unavailable",
            "Shared abuse protection is temporarily unavailable.",
        ) from error
    if not rate.allowed:
        raise _admin_auth_rate_limit_error(
            rate.retry_after_seconds,
            settings.admin_auth_failure_limit,
        )
    raise ApiError(
        401,
        "admin_authentication_required",
        "A valid administrator bearer token is required.",
    )


def _administrator_ip(request: Request) -> str:
    return request.client.host if request.client else "127.0.0.1"


def _admin_work_response(record: AdminWorkRecord) -> AdminWorkResponse:
    pixels = (
        base64.b64encode(record.pixel_data).decode("ascii")
        if record.pixel_data is not None
        else None
    )
    return AdminWorkResponse(
        code=record.code,
        schema_version=record.schema_version,
        palette_id=record.palette_id,
        palette_version=record.palette_version,
        pixels=pixels,
        author_name=record.author_name,
        title=record.title,
        view_count=record.view_count,
        created_at=record.created_at,
        moderation_status=record.moderation_status,
        moderated_at=record.moderated_at,
        moderation_reason=record.moderation_reason,
        purged_at=record.purged_at,
    )


def _storage_error(error: WorkStoreUnavailable) -> ApiError:
    return ApiError(
        503,
        "work_storage_unavailable",
        "Work sharing storage is temporarily unavailable.",
    )


def _state_conflict(error: WorkStateConflict) -> ApiError:
    return ApiError(
        409,
        "work_state_conflict",
        str(error),
    )


def create_admin_router() -> APIRouter:
    router = APIRouter(prefix="/api/v1/admin", tags=["administration"])

    @router.get("/session", response_model=AdminSessionResponse)
    async def verify_session(
        request: Request,
        authorization: AuthorizationHeader = None,
    ) -> AdminSessionResponse:
        await _require_admin(request, authorization)
        return AdminSessionResponse(authenticated=True)

    @router.get(
        "/works",
        response_model=AdminWorkListResponse,
        response_model_exclude_none=True,
    )
    async def list_works(
        request: Request,
        authorization: AuthorizationHeader = None,
        status: Annotated[
            Literal["active", "hidden", "purged"] | None,
            Query(),
        ] = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 48,
        cursor: Annotated[int | None, Query(ge=1)] = None,
        page: Annotated[int | None, Query(ge=1)] = None,
        page_size: Annotated[
            int,
            Query(alias="pageSize", ge=1, le=100),
        ] = 50,
    ) -> AdminWorkListResponse:
        await _require_admin(request, authorization)
        store: WorkStore = request.app.state.work_store
        try:
            if page is not None:
                records, total_count, actual_page = (
                    await store.list_admin_works_page(
                        status=status,
                        page=page,
                        page_size=page_size,
                    )
                )
                total_pages = (
                    total_count + page_size - 1
                ) // page_size
                return AdminWorkListResponse(
                    works=[_admin_work_response(record) for record in records],
                    page=actual_page,
                    page_size=page_size,
                    total_count=total_count,
                    total_pages=total_pages,
                )
            records, next_cursor = await store.list_admin_works(
                status=status,
                limit=limit,
                cursor=cursor,
            )
        except WorkStoreUnavailable as error:
            raise _storage_error(error) from error
        return AdminWorkListResponse(
            works=[_admin_work_response(record) for record in records],
            next_cursor=next_cursor,
        )

    @router.get(
        "/works/{code}",
        response_model=AdminWorkResponse,
        response_model_exclude_none=True,
    )
    async def get_work(
        request: Request,
        code: Annotated[str, Path(pattern=SHARE_CODE_PATTERN)],
        authorization: AuthorizationHeader = None,
    ) -> AdminWorkResponse:
        await _require_admin(request, authorization)
        store: WorkStore = request.app.state.work_store
        try:
            record = await store.get_admin_work(code)
        except WorkStoreUnavailable as error:
            raise _storage_error(error) from error
        if record is None:
            raise ApiError(404, "work_not_found", "Shared work does not exist.")
        return _admin_work_response(record)

    @router.post(
        "/works/{code}/hide",
        response_model=AdminWorkResponse,
        response_model_exclude_none=True,
    )
    async def hide_work(
        request: Request,
        payload: ModerationReasonRequest,
        code: Annotated[str, Path(pattern=SHARE_CODE_PATTERN)],
        authorization: AuthorizationHeader = None,
    ) -> AdminWorkResponse:
        await _require_admin(request, authorization)
        store: WorkStore = request.app.state.work_store
        try:
            record = await store.hide_work(
                code,
                reason=payload.reason,
                request_id=request.state.request_id,
                administrator_ip=_administrator_ip(request),
            )
        except WorkStoreUnavailable as error:
            raise _storage_error(error) from error
        except WorkStateConflict as error:
            raise _state_conflict(error) from error
        if record is None:
            raise ApiError(404, "work_not_found", "Shared work does not exist.")
        return _admin_work_response(record)

    @router.post(
        "/works/{code}/restore",
        response_model=AdminWorkResponse,
        response_model_exclude_none=True,
    )
    async def restore_work(
        request: Request,
        payload: RestoreWorkRequest,
        code: Annotated[str, Path(pattern=SHARE_CODE_PATTERN)],
        authorization: AuthorizationHeader = None,
    ) -> AdminWorkResponse:
        await _require_admin(request, authorization)
        store: WorkStore = request.app.state.work_store
        try:
            record = await store.restore_work(
                code,
                reason=payload.reason,
                request_id=request.state.request_id,
                administrator_ip=_administrator_ip(request),
            )
        except WorkStoreUnavailable as error:
            raise _storage_error(error) from error
        except WorkStateConflict as error:
            raise _state_conflict(error) from error
        if record is None:
            raise ApiError(404, "work_not_found", "Shared work does not exist.")
        return _admin_work_response(record)

    @router.post(
        "/works/{code}/purge",
        response_model=AdminWorkResponse,
        response_model_exclude_none=True,
    )
    async def purge_work(
        request: Request,
        payload: PurgeWorkRequest,
        code: Annotated[str, Path(pattern=SHARE_CODE_PATTERN)],
        authorization: AuthorizationHeader = None,
    ) -> AdminWorkResponse:
        await _require_admin(request, authorization)
        if not secrets.compare_digest(payload.confirmation_code, code):
            raise ApiError(
                409,
                "purge_confirmation_mismatch",
                "The confirmation code does not match the work code.",
            )
        store: WorkStore = request.app.state.work_store
        try:
            record = await store.purge_work(
                code,
                reason=payload.reason,
                request_id=request.state.request_id,
                administrator_ip=_administrator_ip(request),
            )
        except WorkStoreUnavailable as error:
            raise _storage_error(error) from error
        if record is None:
            raise ApiError(404, "work_not_found", "Shared work does not exist.")
        return _admin_work_response(record)

    @router.delete(
        "/works/{code}",
        response_model=ModerationResponse,
        response_model_exclude_none=True,
        deprecated=True,
    )
    async def legacy_hide_work(
        request: Request,
        code: Annotated[str, Path(pattern=SHARE_CODE_PATTERN)],
        authorization: AuthorizationHeader = None,
        reason: Annotated[str | None, Query(max_length=200)] = None,
    ) -> ModerationResponse:
        await _require_admin(request, authorization)
        store: WorkStore = request.app.state.work_store
        try:
            record = await store.hide_work(
                code,
                reason=reason or "Removed by administrator",
                request_id=request.state.request_id,
                administrator_ip=_administrator_ip(request),
            )
        except WorkStoreUnavailable as error:
            raise _storage_error(error) from error
        except WorkStateConflict as error:
            raise _state_conflict(error) from error
        if record is None:
            raise ApiError(404, "work_not_found", "Shared work does not exist.")
        return ModerationResponse(status="hidden", code=code)

    @router.get(
        "/moderation-events",
        response_model=ModerationEventListResponse,
    )
    async def list_moderation_events(
        request: Request,
        authorization: AuthorizationHeader = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        cursor: Annotated[int | None, Query(ge=1)] = None,
    ) -> ModerationEventListResponse:
        await _require_admin(request, authorization)
        store: WorkStore = request.app.state.work_store
        try:
            events, next_cursor = await store.list_moderation_events(
                limit=limit,
                cursor=cursor,
            )
        except WorkStoreUnavailable as error:
            raise _storage_error(error) from error
        return ModerationEventListResponse(
            events=[
                ModerationEventResponse(
                    event_id=event.event_id,
                    action=event.action,
                    target_type=event.target_type,
                    target_value=event.target_value,
                    reason=event.reason,
                    request_id=event.request_id,
                    administrator_ip=event.administrator_ip,
                    created_at=event.created_at,
                )
                for event in events
            ],
            next_cursor=next_cursor,
        )

    @router.post(
        "/bans",
        response_model=ModerationResponse,
        response_model_exclude_none=True,
        status_code=201,
    )
    async def ban_client(
        request: Request,
        payload: BanClientRequest,
        authorization: AuthorizationHeader = None,
    ) -> ModerationResponse:
        await _require_admin(request, authorization)
        client_ip = str(payload.client_ip)
        if payload.ttl_seconds is not None:
            shared_state: SharedState = request.app.state.shared_state
            try:
                await shared_state.ban_temporarily(
                    client_ip,
                    payload.ttl_seconds,
                )
            except SharedStateUnavailable as error:
                raise ApiError(
                    503,
                    "shared_state_unavailable",
                    "Shared abuse protection is temporarily unavailable.",
                ) from error
            scope = "temporary"
        else:
            store: WorkStore = request.app.state.work_store
            try:
                await store.ban_client(client_ip, payload.reason)
            except WorkStoreUnavailable as error:
                raise _storage_error(error) from error
            scope = "persistent"
        return ModerationResponse(
            status="banned",
            client_ip=client_ip,
            scope=scope,
        )

    @router.delete(
        "/bans",
        response_model=ModerationResponse,
        response_model_exclude_none=True,
    )
    async def unban_client(
        request: Request,
        client_ip: Annotated[str, Query(alias="clientIp")],
        authorization: AuthorizationHeader = None,
    ) -> ModerationResponse:
        await _require_admin(request, authorization)
        try:
            normalized_ip = str(ip_address(client_ip))
        except ValueError as error:
            raise ApiError(
                422,
                "invalid_client_ip",
                "clientIp must be a valid IPv4 or IPv6 address.",
            ) from error
        store: WorkStore = request.app.state.work_store
        shared_state: SharedState = request.app.state.shared_state
        try:
            await store.unban_client(normalized_ip)
            await shared_state.unban_temporarily(normalized_ip)
        except WorkStoreUnavailable as error:
            raise _storage_error(error) from error
        except SharedStateUnavailable as error:
            raise ApiError(
                503,
                "shared_state_unavailable",
                "Shared abuse protection is temporarily unavailable.",
            ) from error
        return ModerationResponse(
            status="unbanned",
            client_ip=normalized_ip,
            scope="all",
        )

    return router
