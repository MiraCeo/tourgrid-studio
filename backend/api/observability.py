from __future__ import annotations

import json
import logging
import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from threading import Lock
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import ApiSettings


ACCESS_LOGGER = logging.getLogger("tourgrid.access")
APPLICATION_LOGGER = logging.getLogger("tourgrid.application")
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after_seconds: int


class SlidingWindowRateLimiter:
    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._requests: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str, now: float | None = None) -> RateLimitResult:
        current = time.monotonic() if now is None else now
        cutoff = current - self.window_seconds
        with self._lock:
            entries = self._requests[key]
            while entries and entries[0] <= cutoff:
                entries.popleft()

            if len(entries) >= self.limit:
                retry_after = max(1, int(entries[0] + self.window_seconds - current + 0.999))
                return RateLimitResult(False, 0, retry_after)

            entries.append(current)
            remaining = max(0, self.limit - len(entries))
            return RateLimitResult(True, remaining, 0)


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
    limiter = SlidingWindowRateLimiter(
        settings.rate_limit_requests,
        settings.rate_limit_window_seconds,
    )
    application.state.rate_limiter = limiter

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

        if request.method == "POST" and request.url.path == "/api/v1/convert":
            rate = limiter.check(client_ip)
            if not rate.allowed:
                response = JSONResponse(
                    status_code=429,
                    content={
                        "error": {
                            "code": "rate_limit_exceeded",
                            "message": "Too many conversion requests. Please retry later.",
                        }
                    },
                    headers={
                        "Retry-After": str(rate.retry_after_seconds),
                        "X-RateLimit-Limit": str(limiter.limit),
                        "X-RateLimit-Remaining": "0",
                    },
                )
                status_code = response.status_code
            else:
                response = await _call_application(
                    request,
                    call_next,
                    request_id=request_id,
                    sentry_sdk=sentry_sdk,
                )
                response.headers["X-RateLimit-Limit"] = str(limiter.limit)
                response.headers["X-RateLimit-Remaining"] = str(rate.remaining)
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
