from __future__ import annotations

import asyncio
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

try:
    from psycopg import Error as PsycopgError
    from psycopg_pool import ConnectionPool, PoolTimeout
except ImportError:  # pragma: no cover - production dependency guard
    PsycopgError = None
    ConnectionPool = None
    PoolTimeout = None


SHARE_CODE_ALPHABET = (
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
)
SHARE_CODE_LENGTH = 12
MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"


@dataclass(frozen=True)
class WorkRecord:
    code: str
    schema_version: int
    palette_id: str
    palette_version: int
    pixel_data: bytes
    content_hash: bytes
    author_name: str | None
    title: str | None
    view_count: int
    created_at: datetime


class WorkStore(Protocol):
    async def initialize(self) -> None: ...

    async def close(self) -> None: ...

    async def save(
        self,
        *,
        schema_version: int,
        palette_id: str,
        palette_version: int,
        pixel_data: bytes,
        content_hash: bytes,
        author_name: str | None,
        title: str | None,
    ) -> WorkRecord: ...

    async def get_and_increment_views(self, code: str) -> WorkRecord | None: ...


class WorkStoreUnavailable(RuntimeError):
    pass


def generate_share_code() -> str:
    return "".join(
        secrets.choice(SHARE_CODE_ALPHABET)
        for _ in range(SHARE_CODE_LENGTH)
    )


class UnavailableWorkStore:
    async def initialize(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def save(self, **_values: object) -> WorkRecord:
        raise WorkStoreUnavailable("PostgreSQL storage is not configured")

    async def get_and_increment_views(self, _code: str) -> WorkRecord | None:
        raise WorkStoreUnavailable("PostgreSQL storage is not configured")


class InMemoryWorkStore:
    """Test store with the same immutable and deduplicating semantics."""

    def __init__(self) -> None:
        self._by_code: dict[str, WorkRecord] = {}
        self._code_by_hash: dict[bytes, str] = {}
        self._lock = asyncio.Lock()

    async def initialize(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def save(
        self,
        *,
        schema_version: int,
        palette_id: str,
        palette_version: int,
        pixel_data: bytes,
        content_hash: bytes,
        author_name: str | None,
        title: str | None,
    ) -> WorkRecord:
        async with self._lock:
            existing_code = self._code_by_hash.get(content_hash)
            if existing_code is not None:
                return self._by_code[existing_code]

            code = generate_share_code()
            while code in self._by_code:
                code = generate_share_code()
            record = WorkRecord(
                code=code,
                schema_version=schema_version,
                palette_id=palette_id,
                palette_version=palette_version,
                pixel_data=pixel_data,
                content_hash=content_hash,
                author_name=author_name,
                title=title,
                view_count=0,
                created_at=datetime.now(timezone.utc),
            )
            self._by_code[code] = record
            self._code_by_hash[content_hash] = code
            return record

    async def get_and_increment_views(self, code: str) -> WorkRecord | None:
        async with self._lock:
            record = self._by_code.get(code)
            if record is None:
                return None
            updated = WorkRecord(
                **{
                    **record.__dict__,
                    "view_count": record.view_count + 1,
                }
            )
            self._by_code[code] = updated
            return updated


class PostgresWorkStore:
    def __init__(self, database_url: str) -> None:
        if ConnectionPool is None:
            raise RuntimeError(
                "PostgreSQL dependencies are not installed; "
                "install psycopg[binary,pool]"
            )
        self._pool = ConnectionPool(
            conninfo=database_url,
            min_size=1,
            max_size=5,
            open=False,
        )

    async def initialize(self) -> None:
        await asyncio.to_thread(self._initialize_sync)

    def _initialize_sync(self) -> None:
        self._pool.open()
        self._pool.wait()
        with self._pool.connection() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    name VARCHAR(255) PRIMARY KEY,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            applied = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM schema_migrations"
                ).fetchall()
            }
            for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
                if migration.name in applied:
                    continue
                connection.execute(migration.read_text(encoding="utf-8"))
                connection.execute(
                    "INSERT INTO schema_migrations (name) VALUES (%s)",
                    (migration.name,),
                )

    async def close(self) -> None:
        await asyncio.to_thread(self._pool.close)

    async def save(
        self,
        *,
        schema_version: int,
        palette_id: str,
        palette_version: int,
        pixel_data: bytes,
        content_hash: bytes,
        author_name: str | None,
        title: str | None,
    ) -> WorkRecord:
        try:
            return await asyncio.to_thread(
                self._save_sync,
                schema_version,
                palette_id,
                palette_version,
                pixel_data,
                content_hash,
                author_name,
                title,
            )
        except (PsycopgError, PoolTimeout) as error:
            raise WorkStoreUnavailable(
                "PostgreSQL save operation failed"
            ) from error

    def _save_sync(
        self,
        schema_version: int,
        palette_id: str,
        palette_version: int,
        pixel_data: bytes,
        content_hash: bytes,
        author_name: str | None,
        title: str | None,
    ) -> WorkRecord:
        # Resolve records created before metadata was removed from the digest.
        # The oldest matching pixel payload owns the permanent title and author.
        with self._pool.connection() as connection:
            cursor = connection.execute(
                """
                SELECT
                    code, schema_version, palette_id, palette_version,
                    pixel_data, content_hash, author_name, title,
                    view_count, created_at
                FROM works
                WHERE schema_version = %s
                  AND palette_id = %s
                  AND palette_version = %s
                  AND pixel_data = %s
                ORDER BY created_at ASC, id ASC
                LIMIT 1
                """,
                (
                    schema_version,
                    palette_id,
                    palette_version,
                    pixel_data,
                ),
            )
            row = cursor.fetchone()
            if row is not None:
                return WorkRecord(*row)

        for _attempt in range(8):
            code = generate_share_code()
            with self._pool.connection() as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO works (
                        code,
                        schema_version,
                        palette_id,
                        palette_version,
                        pixel_data,
                        content_hash,
                        author_name,
                        title
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                    RETURNING
                        code, schema_version, palette_id, palette_version,
                        pixel_data, content_hash, author_name, title,
                        view_count, created_at
                    """,
                    (
                        code,
                        schema_version,
                        palette_id,
                        palette_version,
                        pixel_data,
                        content_hash,
                        author_name,
                        title,
                    ),
                )
                row = cursor.fetchone()
                if row is not None:
                    return WorkRecord(*row)

                cursor = connection.execute(
                    """
                    SELECT
                        code, schema_version, palette_id, palette_version,
                        pixel_data, content_hash, author_name, title,
                        view_count, created_at
                    FROM works
                    WHERE content_hash = %s
                    """,
                    (content_hash,),
                )
                row = cursor.fetchone()
                if row is not None:
                    return WorkRecord(*row)

        raise WorkStoreUnavailable("Could not allocate a unique share code")

    async def get_and_increment_views(self, code: str) -> WorkRecord | None:
        try:
            return await asyncio.to_thread(
                self._get_and_increment_views_sync,
                code,
            )
        except (PsycopgError, PoolTimeout) as error:
            raise WorkStoreUnavailable(
                "PostgreSQL read operation failed"
            ) from error

    def _get_and_increment_views_sync(self, code: str) -> WorkRecord | None:
        with self._pool.connection() as connection:
            cursor = connection.execute(
                """
                UPDATE works
                SET view_count = view_count + 1
                WHERE code = %s
                RETURNING
                    code, schema_version, palette_id, palette_version,
                    pixel_data, content_hash, author_name, title,
                    view_count, created_at
                """,
                (code,),
            )
            row = cursor.fetchone()
            return WorkRecord(*row) if row is not None else None


def create_work_store(database_url: str | None) -> WorkStore:
    if not database_url:
        return UnavailableWorkStore()
    return PostgresWorkStore(database_url)
