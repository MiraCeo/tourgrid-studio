from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class ApiSettings:
    rate_limit_requests: int = 60
    rate_limit_window_seconds: float = 60.0
    rate_limit_max_clients: int = 10_000
    environment: str = "development"
    release: str = "0.3.0"
    database_url: str | None = None
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
        }
        for name, value in positive_values.items():
            if value <= 0:
                raise ValueError(f"{name} must be positive")
        if not self.environment.strip():
            raise ValueError("environment cannot be empty")
        if not self.release.strip():
            raise ValueError("release cannot be empty")
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
