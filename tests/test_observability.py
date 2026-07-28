from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.api.config import ApiSettings
from backend.api.observability import SlidingWindowRateLimiter
from backend.api.work_store import InMemoryWorkStore

from test_api import work_payload


def test_request_id_is_preserved_when_valid() -> None:
    application = create_app(ApiSettings(), work_store=InMemoryWorkStore())
    with TestClient(application) as client:
        response = client.get(
            "/api/v1/health",
            headers={"X-Request-ID": "web-01:request_42"},
        )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "web-01:request_42"


def test_invalid_request_id_is_replaced() -> None:
    application = create_app(ApiSettings(), work_store=InMemoryWorkStore())
    with TestClient(application) as client:
        response = client.get(
            "/api/v1/health",
            headers={"X-Request-ID": "contains spaces"},
        )

    generated = response.headers["X-Request-ID"]
    assert len(generated) == 32
    assert generated.isalnum()


def test_shared_work_rate_limit_is_per_client_and_does_not_limit_health() -> None:
    settings = ApiSettings(
        rate_limit_requests=2,
        rate_limit_window_seconds=60,
    )
    application = create_app(
        settings,
        work_store=InMemoryWorkStore(),
    )
    with TestClient(application) as client:
        responses = [
            client.post("/api/v1/works", json=work_payload())
            for _ in range(3)
        ]
        health = client.get("/api/v1/health")

    assert [response.status_code for response in responses] == [201, 201, 429]
    assert responses[0].headers["X-RateLimit-Remaining"] == "1"
    assert responses[2].headers["Retry-After"] == "60"
    assert responses[2].json()["error"]["code"] == "rate_limit_exceeded"
    assert health.status_code == 200


def test_rate_limiter_removes_clients_after_their_window_expires() -> None:
    limiter = SlidingWindowRateLimiter(
        limit=2,
        window_seconds=10,
        max_clients=100,
    )

    limiter.check("client-a", now=0)
    limiter.check("client-b", now=1)
    assert limiter.tracked_clients == 2

    limiter.check("client-c", now=11)

    assert limiter.tracked_clients == 1


def test_rate_limiter_bounds_tracked_clients_under_address_churn() -> None:
    limiter = SlidingWindowRateLimiter(
        limit=2,
        window_seconds=60,
        max_clients=3,
    )

    for index in range(10):
        limiter.check(f"client-{index}", now=float(index))

    assert limiter.tracked_clients == 3


def test_operational_settings_are_loaded_from_environment(monkeypatch) -> None:
    monkeypatch.setenv("TOURGRID_RATE_LIMIT_REQUESTS", "7")
    monkeypatch.setenv("TOURGRID_RATE_LIMIT_WINDOW_SECONDS", "45")
    monkeypatch.setenv("TOURGRID_RATE_LIMIT_MAX_CLIENTS", "4321")
    monkeypatch.setenv("TOURGRID_ENVIRONMENT", "staging")
    monkeypatch.setenv("TOURGRID_RELEASE", "0.3.0-rc.1")
    monkeypatch.setenv("TOURGRID_SENTRY_TRACES_SAMPLE_RATE", "0.1")
    monkeypatch.setenv(
        "TOURGRID_DATABASE_URL",
        "postgresql://tourgrid:secret@db:5432/tourgrid",
    )
    monkeypatch.setenv("TOURGRID_REDIS_URL", "redis://redis:6379/0")
    monkeypatch.setenv("TOURGRID_ADMIN_TOKEN", "a" * 32)
    monkeypatch.setenv("TOURGRID_ADMIN_AUTH_FAILURE_LIMIT", "6")
    monkeypatch.setenv(
        "TOURGRID_ADMIN_AUTH_FAILURE_WINDOW_SECONDS",
        "120",
    )
    monkeypatch.setenv("TOURGRID_VIEW_DEDUPE_SECONDS", "900")

    settings = ApiSettings.from_env()

    assert settings.rate_limit_requests == 7
    assert settings.rate_limit_window_seconds == 45
    assert settings.rate_limit_max_clients == 4321
    assert settings.environment == "staging"
    assert settings.release == "0.3.0-rc.1"
    assert settings.sentry_traces_sample_rate == 0.1
    assert settings.database_url == (
        "postgresql://tourgrid:secret@db:5432/tourgrid"
    )
    assert settings.redis_url == "redis://redis:6379/0"
    assert settings.admin_token == "a" * 32
    assert settings.admin_auth_failure_limit == 6
    assert settings.admin_auth_failure_window_seconds == 120
    assert settings.view_dedupe_seconds == 900


def test_admin_token_cannot_reuse_database_password() -> None:
    reused_secret = "x" * 32
    with pytest.raises(ValueError, match="must not reuse"):
        ApiSettings(
            database_url=(
                f"postgresql://tourgrid:{reused_secret}@db/tourgrid"
            ),
            admin_token=reused_secret,
        ).validated()
