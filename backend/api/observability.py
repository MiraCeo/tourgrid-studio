from __future__ import annotations

import json
import logging
import re
import time
from collections import OrderedDict, deque
from dataclasses import dataclass
from threading import Lock
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import ApiSettings
from .shared_state import SharedStateUnavailable
from .work_store import WorkStoreUnavailable


ACCESS_LOGGER = logging.getLogger("tourgrid.access")
APPLICATION_LOGGER = logging.getLogger("tourgrid.application")
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after_seconds: int


class SlidingWindowRateLimiter:
    def __init__(
        self,
        limit: int,
        window_seconds: float,
        max_clients: int = 10_000,
    ) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self.max_clients = max_clients
        self._requests: OrderedDict[str, deque[float]] = OrderedDict()
        self._next_cleanup_at = 0.0
        self._lock = Lock()

    def check(self, key: str, now: float | None = None) -> RateLimitResult:
        current = time.monotonic() if now is None else now
        cutoff = current - self.window_seconds
        with self._lock:
            if current >= self._next_cleanup_at:
                self._remove_expired_clients(cutoff)
                self._next_cleanup_at = current + min(self.window_seconds, 60.0)

            entries = self._requests.get(key)
            if entries is not None:
                self._remove_expired_entries(entries, cutoff)
                if not entries:
                    del self._requests[key]
                    entries = None

            if entries is None:
                if len(self._requests) >= self.max_clients:
                    self._evict_oldest_client()
                entries = deque()
                self._requests[key] = entries
            else:
                self._requests.move_to_end(key)

            if len(entries) >= self.limit:
                retry_after = max(1, int(entries[0] + self.window_seconds - current + 0.999))
                return RateLimitResult(False, 0, retry_after)

            entries.append(current)
            remaining = max(0, self.limit - len(entries))
            return RateLimitResult(True, remaining, 0)

    @property
    def tracked_clients(self) -> int:
        with self._lock:
            return len(self._requests)

    @staticmethod
    def _remove_expired_entries(entries: deque[float], cutoff: float) -> None:
        while entries and entries[0] <= cutoff:
            entries.popleft()

    def _remove_expired_clients(self, cutoff: float) -> None:
        for key, entries in list(self._requests.items()):
            self._remove_expired_entries(entries, cutoff)
            if not entries:
                del self._requests[key]

    def _evict_oldest_client(self) -> None:
        if not self._requests:
            return
        self._requests.popitem(last=False)


def configure_error_monitoring(settings: ApiSettings) -> Any | None:
    if not settings.sentry_dsn:
        return None

    try:
        import sentry_sdk
    except ImportError:
        APPLICATION_LOGGER.warning(
            "TOURGRID_SENTRY_DSN is configured but sentry-sdk is not installed"
        )
        return None

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        release=settings.release,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        send_default_pii=False,
    )
    return sentry_sdk


def install_operational_middleware(
    application: FastAPI,
    settings: ApiSettings,
    *,
    sentry_sdk: Any | None,
) -> None:
    application.state.rate_limiter = application.state.shared_state

    @application.middleware("http")
    async def operational_middleware(request: Request, call_next):
        started = time.perf_counter()
        supplied_request_id = request.headers.get("x-request-id", "")
        request_id = (
            supplied_request_id
            if REQUEST_ID_PATTERN.fullmatch(supplied_request_id)
            else uuid4().hex
        )
        request.state.request_id = request_id
        client_ip = request.client.host if request.client else "unknown"
        status_code = 500

        is_publish = (
            request.method == "POST"
            and request.url.path == "/api/v1/works"
        )
        is_public_work_request = request.url.path.startswith("/api/v1/works")

        if is_publish:
            try:
                rate = await application.state.shared_state.check_rate_limit(
                    client_ip,
                    limit=settings.rate_limit_requests,
                    window_seconds=settings.rate_limit_window_seconds,
                )
            except SharedStateUnavailable:
                response = _service_unavailable_response(
                    "shared_state_unavailable",
                    "Shared abuse protection is temporarily unavailable.",
                )
                rate = None
            if rate is None:
                status_code = response.status_code
            elif not rate.allowed:
                response = JSONResponse(
                    status_code=429,
                    content={
                        "error": {
                            "code": "rate_limit_exceeded",
                            "message": "Too many write requests. Please retry later.",
                        }
                    },
                    headers={
                        "Retry-After": str(rate.retry_after_seconds),
                        "X-RateLimit-Limit": str(settings.rate_limit_requests),
                        "X-RateLimit-Remaining": "0",
                    },
                )
                status_code = response.status_code
            else:
                response = await _continue_public_request(
                    request,
                    call_next,
                    client_ip=client_ip,
                    request_id=request_id,
                    sentry_sdk=sentry_sdk,
                    check_ban=True,
                )
                response.headers["X-RateLimit-Limit"] = str(
                    settings.rate_limit_requests
                )
                response.headers["X-RateLimit-Remaining"] = str(rate.remaining)
                status_code = response.status_code
        elif is_public_work_request:
            response = await _continue_public_request(
                request,
                call_next,
                client_ip=client_ip,
                request_id=request_id,
                sentry_sdk=sentry_sdk,
                check_ban=True,
            )
            status_code = response.status_code
        else:
            response = await _call_application(
                request,
                call_next,
                request_id=request_id,
                sentry_sdk=sentry_sdk,
            )
            status_code = response.status_code

        response.headers["X-Request-ID"] = request_id
        if request.url.path.startswith("/api/v1/admin"):
            response.headers["Cache-Control"] = "no-store"
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        ACCESS_LOGGER.info(
            json.dumps(
                {
                    "event": "http_request",
                    "requestId": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": status_code,
                    "durationMs": duration_ms,
                    "clientIp": client_ip,
                },
                separators=(",", ":"),
                ensure_ascii=False,
            )
        )
        return response


async def _continue_public_request(
    request: Request,
    call_next,
    *,
    client_ip: str,
    request_id: str,
    sentry_sdk: Any | None,
    check_ban: bool,
):
    if check_ban:
        try:
            temporarily_banned = (
                await request.app.state.shared_state.is_temporarily_banned(
                    client_ip
                )
            )
            persistently_banned = (
                await request.app.state.work_store.is_client_banned(client_ip)
            )
        except SharedStateUnavailable:
            return _service_unavailable_response(
                "shared_state_unavailable",
                "Shared abuse protection is temporarily unavailable.",
            )
        except WorkStoreUnavailable:
            return _service_unavailable_response(
                "work_storage_unavailable",
                "Work sharing storage is temporarily unavailable.",
            )
        if temporarily_banned or persistently_banned:
            return JSONResponse(
                status_code=403,
                content={
                    "error": {
                        "code": "client_banned",
                        "message": "This client is not allowed to access shared works.",
                    }
                },
            )
    return await _call_application(
        request,
        call_next,
        request_id=request_id,
        sentry_sdk=sentry_sdk,
    )


def _service_unavailable_response(code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"error": {"code": code, "message": message}},
    )


async def _call_application(
    request: Request,
    call_next,
    *,
    request_id: str,
    sentry_sdk: Any | None,
):
    try:
        return await call_next(request)
    except Exception as error:
        APPLICATION_LOGGER.exception(
            "Unhandled request error request_id=%s path=%s",
            request_id,
            request.url.path,
        )
        if sentry_sdk is not None:
            sentry_sdk.capture_exception(error)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_server_error",
                    "message": "An unexpected server error occurred.",
                }
            },
        )
