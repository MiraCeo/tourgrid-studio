from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

from backend import APP_VERSION
from backend.api.app import create_app
from backend.api.config import ApiSettings
from backend.api.work_store import InMemoryWorkStore


@pytest.fixture
def settings() -> ApiSettings:
    return ApiSettings()


@pytest.fixture
def client(settings: ApiSettings):
    application = create_app(
        settings,
        work_store=InMemoryWorkStore(),
    )
    with TestClient(application) as test_client:
        yield test_client


def packed_pixels(fill: int = 0) -> str:
    return base64.b64encode(bytes([fill]) * 432).decode("ascii")


def work_payload(
    fill: int = 0,
    *,
    title: str | None = None,
    author_name: str | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "schemaVersion": 1,
        "paletteId": "natural-64-v1",
        "paletteVersion": 1,
        "pixels": packed_pixels(fill),
    }
    if title is not None:
        payload["title"] = title
    if author_name is not None:
        payload["authorName"] = author_name
    return payload


def test_health_reports_application_version(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "appVersion": APP_VERSION,
        "defaultPaletteId": "natural-64-v1",
    }


def test_server_conversion_routes_are_removed(client: TestClient) -> None:
    assert client.post("/api/v1/convert").status_code == 404
    assert (
        client.get(
            "/api/v1/results/00000000000000000000000000000000/preview.png"
        ).status_code
        == 404
    )
    paths = client.get("/openapi.json").json()["paths"]
    assert "/api/v1/convert" not in paths
    assert "/api/v1/results/{result_id}/preview.png" not in paths


def test_shared_work_is_immutable_deduplicated_and_counted(
    client: TestClient,
) -> None:
    first = client.post("/api/v1/works", json=work_payload())
    duplicate = client.post("/api/v1/works", json=work_payload())

    assert first.status_code == 201
    assert duplicate.status_code == 201
    first_body = first.json()
    assert duplicate.json()["code"] == first_body["code"]
    assert len(first_body["code"]) == 12
    assert first_body["pixels"] == packed_pixels()
    assert first_body["authorName"] is None
    assert first_body["title"] is None
    assert first_body["viewCount"] == 0

    opened_once = client.get(f"/api/v1/works/{first_body['code']}")
    opened_twice = client.get(f"/api/v1/works/{first_body['code']}")
    assert opened_once.status_code == 200
    assert opened_once.json()["viewCount"] == 1
    assert opened_twice.json()["viewCount"] == 2


def test_different_shared_work_gets_a_different_code(client: TestClient) -> None:
    first = client.post("/api/v1/works", json=work_payload(0))
    second = client.post("/api/v1/works", json=work_payload(1))

    assert first.json()["code"] != second.json()["code"]


def test_shared_work_metadata_is_normalized_validated_and_deduplicated(
    client: TestClient,
) -> None:
    first = client.post(
        "/api/v1/works",
        json=work_payload(title="  巡展作品  ", author_name="  Mira  "),
    )
    duplicate = client.post(
        "/api/v1/works",
        json=work_payload(title="巡展作品", author_name="Mira"),
    )
    renamed = client.post(
        "/api/v1/works",
        json=work_payload(title="另一作品", author_name="Mira"),
    )
    too_long = client.post(
        "/api/v1/works",
        json=work_payload(title="超过十个字的作品标题啊"),
    )

    assert first.status_code == 201
    assert first.json()["title"] == "巡展作品"
    assert first.json()["authorName"] == "Mira"
    assert duplicate.json()["code"] == first.json()["code"]
    assert renamed.json()["code"] == first.json()["code"]
    assert renamed.json()["title"] == "巡展作品"
    assert renamed.json()["authorName"] == "Mira"
    assert too_long.status_code == 422


def test_shared_work_rejects_invalid_payload_and_palette_version(
    client: TestClient,
) -> None:
    short_payload = work_payload()
    short_payload["pixels"] = base64.b64encode(b"short").decode("ascii")
    invalid_length = client.post("/api/v1/works", json=short_payload)

    wrong_palette = work_payload()
    wrong_palette["paletteVersion"] = 2
    palette_mismatch = client.post("/api/v1/works", json=wrong_palette)

    assert invalid_length.status_code == 422
    assert (
        invalid_length.json()["error"]["code"]
        == "request_validation_failed"
    )
    assert palette_mismatch.status_code == 409
    assert (
        palette_mismatch.json()["error"]["code"]
        == "palette_version_mismatch"
    )


def test_unknown_shared_work_returns_404(client: TestClient) -> None:
    response = client.get("/api/v1/works/123456789ABC")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "work_not_found"


def test_shared_work_returns_503_when_database_is_not_configured(
    settings: ApiSettings,
) -> None:
    application = create_app(settings)
    with TestClient(application) as unavailable_client:
        response = unavailable_client.post(
            "/api/v1/works",
            json=work_payload(),
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "work_storage_unavailable"


def test_editor_is_served_from_same_origin(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert 'id="pixelCanvas"' in response.text
    assert '/static/js/import.js' in response.text

    script_response = client.get("/static/js/import.js")
    assert script_response.status_code == 200
    assert "/api/v1/convert" not in script_response.text


def test_palette_list_and_detail(client: TestClient) -> None:
    list_response = client.get("/api/v1/palettes")
    detail_response = client.get("/api/v1/palettes/natural-64-v1")

    assert list_response.status_code == 200
    assert list_response.json() == [
        {
            "id": "natural-64-v1",
            "name": "Natural 64 v1",
            "version": 1,
            "status": "provisional",
            "colorCount": 64,
        }
    ]

    detail = detail_response.json()
    assert detail_response.status_code == 200
    assert detail["sampledColorCount"] == 24
    assert detail["predictedColorCount"] == 40
    assert len(detail["colors"]) == 64
    assert detail["colors"][0] == {
        "id": "N01",
        "name": "Black",
        "rgb": [34, 34, 34],
        "hex": "#222222",
        "confirmed": True,
    }


def test_unknown_palette_uses_error_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/palettes/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "palette_not_found"
