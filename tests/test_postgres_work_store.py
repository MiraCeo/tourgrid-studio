from __future__ import annotations

import asyncio
import hashlib
import os
import secrets

import pytest
from psycopg import connect
from fastapi.testclient import TestClient

from backend.api.app import create_app
from backend.api.config import ApiSettings
from backend.api.work_store import PostgresWorkStore, WorkModerated
from backend.api.works import content_digest


@pytest.mark.integration
@pytest.mark.postgres_store
def test_postgres_store_saves_deduplicates_and_counts_views() -> None:
    database_url = os.getenv("TOURGRID_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TOURGRID_TEST_DATABASE_URL is not configured")

    pixel_data = secrets.token_bytes(432)
    content_hash = hashlib.sha256(b"postgres-test\0" + pixel_data).digest()

    async def exercise() -> None:
        store = PostgresWorkStore(database_url)
        await store.initialize()
        try:
            values = {
                "schema_version": 1,
                "palette_id": "natural-64-v2",
                "palette_version": 2,
                "pixel_data": pixel_data,
                "content_hash": content_hash,
                "author_name": None,
                "title": None,
            }
            first = await store.save(**values)
            duplicate = await store.save(**values)
            opened_once = await store.get_and_increment_views(first.code)
            opened_twice = await store.get_and_increment_views(first.code)

            assert duplicate.code == first.code
            assert opened_once is not None
            assert opened_once.view_count == 1
            assert opened_twice is not None
            assert opened_twice.view_count == 2

            def remove_test_record() -> None:
                with connect(database_url) as connection:
                    connection.execute(
                        "DELETE FROM works WHERE content_hash = %s",
                        (content_hash,),
                    )

            await asyncio.to_thread(remove_test_record)
        finally:
            await store.close()

    asyncio.run(exercise())


@pytest.mark.integration
def test_work_api_round_trips_through_postgres() -> None:
    import base64

    database_url = os.getenv("TOURGRID_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TOURGRID_TEST_DATABASE_URL is not configured")

    pixel_data = secrets.token_bytes(432)
    request_body = {
        "schemaVersion": 1,
        "paletteId": "natural-64-v2",
        "paletteVersion": 2,
        "pixels": base64.b64encode(pixel_data).decode("ascii"),
        "authorName": "Mira",
        "title": "巡展作品",
    }
    application = create_app(ApiSettings(database_url=database_url))

    with TestClient(application) as client:
        saved = client.post("/api/v1/works", json=request_body)
        duplicate = client.post("/api/v1/works", json=request_body)
        renamed_body = {
            **request_body,
            "authorName": "博士",
            "title": "另一作品",
        }
        renamed = client.post("/api/v1/works", json=renamed_body)
        opened = client.get(f"/api/v1/works/{saved.json()['code']}")

    assert saved.status_code == 201
    assert duplicate.json()["code"] == saved.json()["code"]
    assert renamed.json()["code"] == saved.json()["code"]
    assert renamed.json()["authorName"] == "Mira"
    assert renamed.json()["title"] == "巡展作品"
    assert opened.status_code == 200
    assert opened.json()["pixels"] == request_body["pixels"]
    assert opened.json()["authorName"] == "Mira"
    assert opened.json()["title"] == "巡展作品"
    assert opened.json()["viewCount"] == 1

    with connect(database_url) as connection:
        content_hash_hex = connection.execute(
            "SELECT encode(content_hash, 'hex') FROM works WHERE code = %s",
            (saved.json()["code"],),
        ).fetchone()[0]
        connection.execute(
            "DELETE FROM works WHERE content_hash = %s",
            (bytes.fromhex(content_hash_hex),),
        )


@pytest.mark.integration
@pytest.mark.postgres_store
def test_postgres_admin_lifecycle_lists_restores_and_purges() -> None:
    database_url = os.getenv("TOURGRID_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("TOURGRID_TEST_DATABASE_URL is not configured")

    pixel_data = secrets.token_bytes(432)
    content_hash = content_digest(
        schema_version=1,
        palette_id="natural-64-v2",
        palette_version=2,
        pixel_data=pixel_data,
    )

    async def exercise() -> None:
        store = PostgresWorkStore(database_url)
        await store.initialize()
        code = ""
        try:
            record = await store.save(
                schema_version=1,
                palette_id="natural-64-v2",
                palette_version=2,
                pixel_data=pixel_data,
                content_hash=content_hash,
                author_name="Mira",
                title="管理测试",
            )
            code = record.code
            listed, _cursor = await store.list_admin_works(
                status=None,
                limit=100,
                cursor=None,
            )
            assert code in {item.code for item in listed}
            page_items, total_count, actual_page = (
                await store.list_admin_works_page(
                    status=None,
                    page=1,
                    page_size=50,
                )
            )
            assert code in {item.code for item in page_items}
            assert total_count >= 1
            assert actual_page == 1
            batch = await store.get_admin_works([code])
            assert [item.code for item in batch] == [code]

            hidden = await store.hide_work(
                code,
                reason="integration review",
                request_id="integration-hide",
                administrator_ip="127.0.0.1",
            )
            assert hidden is not None
            assert hidden.moderation_status == "hidden"
            assert await store.get(code) is None
            hidden_state = await store.get_moderation_state(code)
            assert hidden_state is not None
            assert hidden_state.status == "hidden"
            assert hidden_state.reason == "integration review"

            restored = await store.restore_work(
                code,
                reason="integration approved",
                request_id="integration-restore",
                administrator_ip="127.0.0.1",
            )
            assert restored is not None
            assert restored.moderation_status == "active"

            purged = await store.purge_work(
                code,
                reason="integration purge",
                request_id="integration-purge",
                administrator_ip="127.0.0.1",
            )
            assert purged is not None
            assert purged.moderation_status == "purged"
            assert purged.pixel_data is None
            purged_state = await store.get_moderation_state(code)
            assert purged_state is not None
            assert purged_state.status == "purged"
            assert purged_state.reason == "integration purge"
            with pytest.raises(WorkModerated):
                await store.save(
                    schema_version=1,
                    palette_id="natural-64-v2",
                    palette_version=2,
                    pixel_data=pixel_data,
                    content_hash=content_hash,
                    author_name=None,
                    title=None,
                )

            def verify_and_remove() -> None:
                with connect(database_url) as connection:
                    row = connection.execute(
                        """
                        SELECT pixel_data, author_name, title
                        FROM works
                        WHERE code = %s
                        """,
                        (code,),
                    ).fetchone()
                    assert row == (None, None, None)
                    assert connection.execute(
                        """
                        SELECT 1 FROM work_tombstones
                        WHERE canonical_content_hash = %s
                        """,
                        (content_hash,),
                    ).fetchone() == (1,)
                    connection.execute(
                        "DELETE FROM moderation_events WHERE target_value = %s",
                        (code,),
                    )
                    connection.execute(
                        "DELETE FROM works WHERE code = %s",
                        (code,),
                    )

            await asyncio.to_thread(verify_and_remove)
        finally:
            await store.close()

    asyncio.run(exercise())
