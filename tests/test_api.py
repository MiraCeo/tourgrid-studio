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
    assert opened_twice.json()["viewCount"] == 1

    client.cookies.delete("tourgrid_viewer")
    opened_from_new_session = client.get(
        f"/api/v1/works/{first_body['code']}"
    )
    assert opened_from_new_session.json()["viewCount"] == 2


def test_missing_shared_work_returns_chinese_message(
    client: TestClient,
) -> None:
    response = client.get("/api/v1/works/123456789ABC")

    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "work_not_found",
            "message": "该作品不存在。",
        }
    }


def test_legacy_admin_delete_hides_and_tombstones_a_work() -> None:
    token = "a" * 32
    application = create_app(
        ApiSettings(admin_token=token),
        work_store=InMemoryWorkStore(),
    )
    with TestClient(application) as admin_client:
        created = admin_client.post("/api/v1/works", json=work_payload())
        code = created.json()["code"]

        unauthorized = admin_client.delete(f"/api/v1/admin/works/{code}")
        deleted = admin_client.delete(
            f"/api/v1/admin/works/{code}",
            headers={"Authorization": f"Bearer {token}"},
            params={"reason": "moderation test"},
        )
        opened = admin_client.get(f"/api/v1/works/{code}")
        republished = admin_client.post(
            "/api/v1/works",
            json=work_payload(),
        )

    assert unauthorized.status_code == 401
    assert deleted.status_code == 200
    assert deleted.json() == {
        "status": "hidden",
        "code": code,
    }
    assert opened.status_code == 404
    assert republished.status_code == 403
    assert republished.json()["error"]["code"] == "work_blocked"


def test_admin_can_list_preview_and_manage_every_work() -> None:
    token = "c" * 32
    application = create_app(
        ApiSettings(admin_token=token),
        work_store=InMemoryWorkStore(),
    )
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(application) as admin_client:
        created = [
            admin_client.post(
                "/api/v1/works",
                json=work_payload(
                    fill,
                    title=f"作品{fill}",
                    author_name="Mira",
                ),
            ).json()
            for fill in range(3)
        ]
        session = admin_client.get("/api/v1/admin/session", headers=headers)
        listed = admin_client.get(
            "/api/v1/admin/works",
            headers=headers,
            params={"limit": 2},
        )
        second_page = admin_client.get(
            "/api/v1/admin/works",
            headers=headers,
            params={
                "limit": 2,
                "cursor": listed.json()["nextCursor"],
            },
        )
        code = created[0]["code"]
        detail = admin_client.get(
            f"/api/v1/admin/works/{code}",
            headers=headers,
        )
        hidden = admin_client.post(
            f"/api/v1/admin/works/{code}/hide",
            headers=headers,
            json={"reason": "review"},
        )
        public_while_hidden = admin_client.get(f"/api/v1/works/{code}")
        restored = admin_client.post(
            f"/api/v1/admin/works/{code}/restore",
            headers=headers,
            json={"reason": "approved"},
        )
        public_after_restore = admin_client.get(f"/api/v1/works/{code}")

    assert session.json() == {"authenticated": True}
    assert session.headers["Cache-Control"] == "no-store"
    assert len(listed.json()["works"]) == 2
    assert listed.json()["nextCursor"] is not None
    assert len(second_page.json()["works"]) == 1
    all_codes = {
        item["code"]
        for item in listed.json()["works"] + second_page.json()["works"]
    }
    assert all_codes == {item["code"] for item in created}
    assert all(item["pixels"] for item in listed.json()["works"])
    assert detail.json()["pixels"] == created[0]["pixels"]
    assert detail.json()["title"] == "作品0"
    assert detail.json()["authorName"] == "Mira"
    assert hidden.json()["moderationStatus"] == "hidden"
    assert public_while_hidden.status_code == 404
    assert public_while_hidden.json() == {
        "error": {
            "code": "work_hidden",
            "message": "该作品已被隐藏。处理原因：review。",
        }
    }
    assert restored.json()["moderationStatus"] == "active"
    assert public_after_restore.status_code == 200


def test_admin_purge_removes_content_and_keeps_tombstone() -> None:
    token = "d" * 32
    application = create_app(
        ApiSettings(admin_token=token),
        work_store=InMemoryWorkStore(),
    )
    headers = {"Authorization": f"Bearer {token}"}
    payload = work_payload(7, title="待清除", author_name="Mira")
    with TestClient(application) as admin_client:
        created = admin_client.post("/api/v1/works", json=payload).json()
        code = created["code"]
        mismatch = admin_client.post(
            f"/api/v1/admin/works/{code}/purge",
            headers=headers,
            json={
                "confirmationCode": "123456789ABC",
                "reason": "permanent removal",
            },
        )
        purged = admin_client.post(
            f"/api/v1/admin/works/{code}/purge",
            headers=headers,
            json={
                "confirmationCode": code,
                "reason": "permanent removal",
            },
        )
        public_after_purge = admin_client.get(f"/api/v1/works/{code}")
        restore = admin_client.post(
            f"/api/v1/admin/works/{code}/restore",
            headers=headers,
            json={},
        )
        republished = admin_client.post("/api/v1/works", json=payload)
        purged_list = admin_client.get(
            "/api/v1/admin/works",
            headers=headers,
            params={"status": "purged"},
        )
        events = admin_client.get(
            "/api/v1/admin/moderation-events",
            headers=headers,
        )

    assert mismatch.status_code == 409
    assert mismatch.json()["error"]["code"] == "purge_confirmation_mismatch"
    assert purged.status_code == 200
    assert purged.json()["moderationStatus"] == "purged"
    assert "pixels" not in purged.json()
    assert "authorName" not in purged.json()
    assert "title" not in purged.json()
    assert public_after_purge.status_code == 404
    assert public_after_purge.json() == {
        "error": {
            "code": "work_deleted",
            "message": "该作品已被删除。处理原因：permanent removal。",
        }
    }
    assert restore.status_code == 409
    assert republished.status_code == 403
    assert [item["code"] for item in purged_list.json()["works"]] == [code]
    assert events.json()["events"][0]["action"] == "work_purged"


def test_admin_can_apply_and_remove_shared_temporary_ban() -> None:
    token = "b" * 32
    application = create_app(
        ApiSettings(admin_token=token),
        work_store=InMemoryWorkStore(),
    )
    with TestClient(
        application,
        client=("127.0.0.1", 50_000),
    ) as admin_client:
        banned = admin_client.post(
            "/api/v1/admin/bans",
            headers={"Authorization": f"Bearer {token}"},
            json={"clientIp": "127.0.0.1", "ttlSeconds": 600},
        )
        blocked = admin_client.get("/api/v1/works/123456789ABC")
        unbanned = admin_client.delete(
            "/api/v1/admin/bans",
            headers={"Authorization": f"Bearer {token}"},
            params={"clientIp": "127.0.0.1"},
        )
        after_unban = admin_client.get("/api/v1/works/123456789ABC")

    assert banned.status_code == 201
    assert banned.json()["scope"] == "temporary"
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "client_banned"
    assert unbanned.status_code == 200
    assert after_unban.status_code == 404


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


def test_admin_interface_is_served_without_embedding_credentials(
    client: TestClient,
) -> None:
    response = client.get("/admin/")
    script = client.get("/admin/admin.js")

    assert response.status_code == 200
    assert "<title>Tourgrid Studio Admin</title>" in response.text
    assert "localStorage" not in script.text
    assert "sessionStorage" not in script.text
    assert "Authorization" in script.text


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
