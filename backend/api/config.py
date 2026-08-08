from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import unquote, urlsplit


@dataclass(frozen=True)
class ApiSettings:
    rate_limit_requests: int = 60
    rate_limit_window_seconds: float = 60.0
    rate_limit_max_clients: int = 10_000
    environment: str = "development"
    release: str = "0.3.2"
    database_url: str | None = None
    redis_url: str | None = None
    admin_token: str | None = None
    admin_auth_failure_limit: int = 5
    admin_auth_failure_window_seconds: float = 900.0
    view_dedupe_seconds: int = 1_800
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.0

    @classmethod
    def from_env(cls) -> "ApiSettings":
        defaults = cls()
        return cls(
            rate_limit_requests=_env_int(
                "TOURGRID_RATE_LIMIT_REQUESTS",
                defaults.rate_limit_requests,
            ),
            rate_limit_window_seconds=_env_float(
                "TOURGRID_RATE_LIMIT_WINDOW_SECONDS",
                defaults.rate_limit_window_seconds,
            ),
            rate_limit_max_clients=_env_int(
                "TOURGRID_RATE_LIMIT_MAX_CLIENTS",
                defaults.rate_limit_max_clients,
            ),
            environment=os.getenv(
                "TOURGRID_ENVIRONMENT",
                defaults.environment,
            ),
            release=os.getenv("TOURGRID_RELEASE", defaults.release),
            database_url=os.getenv("TOURGRID_DATABASE_URL") or None,
            redis_url=os.getenv("TOURGRID_REDIS_URL") or None,
            admin_token=os.getenv("TOURGRID_ADMIN_TOKEN") or None,
            admin_auth_failure_limit=_env_int(
                "TOURGRID_ADMIN_AUTH_FAILURE_LIMIT",
                defaults.admin_auth_failure_limit,
            ),
            admin_auth_failure_window_seconds=_env_float(
                "TOURGRID_ADMIN_AUTH_FAILURE_WINDOW_SECONDS",
                defaults.admin_auth_failure_window_seconds,
            ),
            view_dedupe_seconds=_env_int(
                "TOURGRID_VIEW_DEDUPE_SECONDS",
                defaults.view_dedupe_seconds,
            ),
            sentry_dsn=os.getenv("TOURGRID_SENTRY_DSN") or None,
            sentry_traces_sample_rate=_env_float(
                "TOURGRID_SENTRY_TRACES_SAMPLE_RATE",
                defaults.sentry_traces_sample_rate,
            ),
        ).validated()

    def validated(self) -> "ApiSettings":
        positive_values = {
            "rate_limit_requests": self.rate_limit_requests,
            "rate_limit_window_seconds": self.rate_limit_window_seconds,
            "rate_limit_max_clients": self.rate_limit_max_clients,
            "admin_auth_failure_limit": self.admin_auth_failure_limit,
            "admin_auth_failure_window_seconds": (
                self.admin_auth_failure_window_seconds
            ),
            "view_dedupe_seconds": self.view_dedupe_seconds,
        }
        for name, value in positive_values.items():
            if value <= 0:
                raise ValueError(f"{name} must be positive")
        if not self.environment.strip():
            raise ValueError("environment cannot be empty")
        if not self.release.strip():
            raise ValueError("release cannot be empty")
        if self.admin_token is not None:
            if (
                len(self.admin_token) < 32
                or self.admin_token != self.admin_token.strip()
            ):
                raise ValueError(
                    "admin_token must be at least 32 characters without "
                    "leading or trailing whitespace"
                )
            if self.database_url:
                database_password = urlsplit(self.database_url).password
                if (
                    database_password is not None
                    and self.admin_token == unquote(database_password)
                ):
                    raise ValueError(
                        "admin_token must not reuse the database password"
                    )
        if not 0 <= self.sentry_traces_sample_rate <= 1:
            raise ValueError("sentry_traces_sample_rate must be between 0 and 1")
        return self


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError as error:
        raise ValueError(f"{name} must be a number") from error
