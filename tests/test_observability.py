from __future__ import annotations

from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.api.config import ApiSettings

from test_api import fake_conversion, image_bytes


def test_request_id_is_preserved_when_valid() -> None:
    application = create_app(ApiSettings(), converter=fake_conversion)
    with TestClient(application) as client:
        response = client.get(
            "/api/v1/health",
            headers={"X-Request-ID": "web-01:request_42"},
        )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "web-01:request_42"


def test_invalid_request_id_is_replaced() -> None:
    application = create_app(ApiSettings(), converter=fake_conversion)
    with TestClient(application) as client:
        response = client.get(
            "/api/v1/health",
            headers={"X-Request-ID": "contains spaces"},
        )

    generated = response.headers["X-Request-ID"]
    assert len(generated) == 32
    assert generated.isalnum()


def test_convert_rate_limit_is_per_client_and_does_not_limit_health() -> None:
    settings = ApiSettings(
        rate_limit_requests=2,
        rate_limit_window_seconds=60,
    )
    application = create_app(settings, converter=fake_conversion)
    with TestClient(application) as client:
        responses = [
            client.post(
                "/api/v1/convert",
                files={"image": ("source.png", image_bytes(), "image/png")},
            )
            for _ in range(3)
        ]
        health = client.get("/api/v1/health")

    assert [response.status_code for response in responses] == [200, 200, 429]
    assert responses[0].headers["X-RateLimit-Remaining"] == "1"
    assert responses[2].headers["Retry-After"] == "60"
    assert responses[2].json()["error"]["code"] == "rate_limit_exceeded"
    assert health.status_code == 200


def test_operational_settings_are_loaded_from_environment(monkeypatch) -> None:
    monkeypatch.setenv("TOURGRID_RATE_LIMIT_REQUESTS", "7")
    monkeypatch.setenv("TOURGRID_RATE_LIMIT_WINDOW_SECONDS", "45")
    monkeypatch.setenv("TOURGRID_ENVIRONMENT", "staging")
    monkeypatch.setenv("TOURGRID_RELEASE", "0.2.0-rc.1")
    monkeypatch.setenv("TOURGRID_SENTRY_TRACES_SAMPLE_RATE", "0.1")

    settings = ApiSettings.from_env()

    assert settings.rate_limit_requests == 7
    assert settings.rate_limit_window_seconds == 45
    assert settings.environment == "staging"
    assert settings.release == "0.2.0-rc.1"
    assert settings.sentry_traces_sample_rate == 0.1
