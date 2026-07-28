from __future__ import annotations

import asyncio
import hashlib
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


def canonical_content_digest(
    *,
    schema_version: int,
    palette_id: str,
    palette_version: int,
    pixel_data: bytes,
) -> bytes:
    canonical = (
        b"tourgrid-work\0"
        + schema_version.to_bytes(2, "big")
        + palette_id.encode("ascii")
        + b"\0"
        + palette_version.to_bytes(2, "big")
        + pixel_data
    )
    return hashlib.sha256(canonical).digest()


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


@dataclass(frozen=True)
class AdminWorkRecord:
    code: str
    schema_version: int
    palette_id: str
    palette_version: int
    pixel_data: bytes | None
    author_name: str | None
    title: str | None
    view_count: int
    created_at: datetime
    moderation_status: str
    moderated_at: datetime | None
    moderation_reason: str | None
    purged_at: datetime | None


@dataclass(frozen=True)
class WorkModerationState:
    status: str
    reason: str | None


@dataclass(frozen=True)
class ModerationEventRecord:
    event_id: int
    action: str
    target_type: str
    target_value: str
    reason: str | None
    request_id: str | None
    administrator_ip: str | None
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

    async def get(self, code: str) -> WorkRecord | None: ...

    async def get_moderation_state(
        self,
        code: str,
    ) -> WorkModerationState | None: ...

    async def delete_work(self, code: str, reason: str | None) -> bool: ...

    async def is_client_banned(self, client_ip: str) -> bool: ...

    async def ban_client(self, client_ip: str, reason: str | None) -> None: ...

    async def unban_client(self, client_ip: str) -> None: ...

    async def list_admin_works(
        self,
        *,
        status: str | None,
        limit: int,
        cursor: int | None,
    ) -> tuple[list[AdminWorkRecord], int | None]: ...

    async def get_admin_work(self, code: str) -> AdminWorkRecord | None: ...

    async def hide_work(
        self,
        code: str,
        *,
        reason: str,
        request_id: str,
        administrator_ip: str,
    ) -> AdminWorkRecord | None: ...

    async def restore_work(
        self,
        code: str,
        *,
        reason: str | None,
        request_id: str,
        administrator_ip: str,
    ) -> AdminWorkRecord | None: ...

    async def purge_work(
        self,
        code: str,
        *,
        reason: str,
        request_id: str,
        administrator_ip: str,
    ) -> AdminWorkRecord | None: ...

    async def list_moderation_events(
        self,
        *,
        limit: int,
        cursor: int | None,
    ) -> tuple[list[ModerationEventRecord], int | None]: ...


class WorkStoreUnavailable(RuntimeError):
    pass


class WorkModerated(RuntimeError):
    pass


class WorkStateConflict(RuntimeError):
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

    async def get(self, _code: str) -> WorkRecord | None:
        raise WorkStoreUnavailable("PostgreSQL storage is not configured")

    async def get_moderation_state(
        self,
        _code: str,
    ) -> WorkModerationState | None:
        raise WorkStoreUnavailable("PostgreSQL storage is not configured")

    async def delete_work(self, _code: str, _reason: str | None) -> bool:
        raise WorkStoreUnavailable("PostgreSQL storage is not configured")

    async def is_client_banned(self, _client_ip: str) -> bool:
        raise WorkStoreUnavailable("PostgreSQL storage is not configured")

    async def ban_client(self, _client_ip: str, _reason: str | None) -> None:
        raise WorkStoreUnavailable("PostgreSQL storage is not configured")

    async def unban_client(self, _client_ip: str) -> None:
        raise WorkStoreUnavailable("PostgreSQL storage is not configured")

    async def list_admin_works(self, **_values: object):
        raise WorkStoreUnavailable("PostgreSQL storage is not configured")

    async def get_admin_work(self, _code: str):
        raise WorkStoreUnavailable("PostgreSQL storage is not configured")

    async def hide_work(self, _code: str, **_values: object):
        raise WorkStoreUnavailable("PostgreSQL storage is not configured")

    async def restore_work(self, _code: str, **_values: object):
        raise WorkStoreUnavailable("PostgreSQL storage is not configured")

    async def purge_work(self, _code: str, **_values: object):
        raise WorkStoreUnavailable("PostgreSQL storage is not configured")

    async def list_moderation_events(self, **_values: object):
        raise WorkStoreUnavailable("PostgreSQL storage is not configured")


class InMemoryWorkStore:
    """Test store with the same immutable and deduplicating semantics."""

    def __init__(self) -> None:
        self._by_code: dict[str, WorkRecord] = {}
        self._code_by_hash: dict[bytes, str] = {}
        self._lock = asyncio.Lock()
        self._deleted_codes: set[str] = set()
        self._banned_clients: set[str] = set()
        self._status_by_code: dict[str, str] = {}
        self._moderation_by_code: dict[
            str,
            tuple[datetime | None, str | None, datetime | None],
        ] = {}
        self._id_by_code: dict[str, int] = {}
        self._next_id = 1
        self._events: list[ModerationEventRecord] = []

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
                if existing_code in self._deleted_codes:
                    raise WorkModerated("This work has been moderated")
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
            self._status_by_code[code] = "active"
            self._moderation_by_code[code] = (None, None, None)
            self._id_by_code[code] = self._next_id
            self._next_id += 1
            return record

    async def get_and_increment_views(self, code: str) -> WorkRecord | None:
        async with self._lock:
            record = self._by_code.get(code)
            if record is None or code in self._deleted_codes:
                return None
            updated = WorkRecord(
                **{
                    **record.__dict__,
                    "view_count": record.view_count + 1,
                }
            )
            self._by_code[code] = updated
            return updated

    async def get(self, code: str) -> WorkRecord | None:
        async with self._lock:
            if code in self._deleted_codes:
                return None
            return self._by_code.get(code)

    async def get_moderation_state(
        self,
        code: str,
    ) -> WorkModerationState | None:
        async with self._lock:
            status = self._status_by_code.get(code)
            if status is None:
                return None
            _moderated_at, reason, _purged_at = self._moderation_by_code[code]
            return WorkModerationState(status=status, reason=reason)

    async def delete_work(self, code: str, reason: str | None) -> bool:
        result = await self.hide_work(
            code,
            reason=reason or "Removed by administrator",
            request_id="legacy-delete",
            administrator_ip="127.0.0.1",
        )
        return result is not None

    async def is_client_banned(self, client_ip: str) -> bool:
        async with self._lock:
            return client_ip in self._banned_clients

    async def ban_client(self, client_ip: str, reason: str | None) -> None:
        del reason
        async with self._lock:
            self._banned_clients.add(client_ip)

    async def unban_client(self, client_ip: str) -> None:
        async with self._lock:
            self._banned_clients.discard(client_ip)

    def _admin_record(self, code: str) -> AdminWorkRecord:
        record = self._by_code[code]
        status = self._status_by_code[code]
        moderated_at, reason, purged_at = self._moderation_by_code[code]
        return AdminWorkRecord(
            code=record.code,
            schema_version=record.schema_version,
            palette_id=record.palette_id,
            palette_version=record.palette_version,
            pixel_data=None if status == "purged" else record.pixel_data,
            author_name=None if status == "purged" else record.author_name,
            title=None if status == "purged" else record.title,
            view_count=record.view_count,
            created_at=record.created_at,
            moderation_status=status,
            moderated_at=moderated_at,
            moderation_reason=reason,
            purged_at=purged_at,
        )

    def _record_event(
        self,
        *,
        action: str,
        target_value: str,
        reason: str | None,
        request_id: str,
        administrator_ip: str,
    ) -> None:
        self._events.append(
            ModerationEventRecord(
                event_id=len(self._events) + 1,
                action=action,
                target_type="work",
                target_value=target_value,
                reason=reason,
                request_id=request_id,
                administrator_ip=administrator_ip,
                created_at=datetime.now(timezone.utc),
            )
        )

    async def list_admin_works(
        self,
        *,
        status: str | None,
        limit: int,
        cursor: int | None,
    ) -> tuple[list[AdminWorkRecord], int | None]:
        async with self._lock:
            candidates = sorted(
                (
                    (record_id, code)
                    for code, record_id in self._id_by_code.items()
                    if cursor is None or record_id < cursor
                ),
                reverse=True,
            )
            if status is not None:
                candidates = [
                    item
                    for item in candidates
                    if self._status_by_code[item[1]] == status
                ]
            selected = candidates[:limit]
            next_cursor = (
                selected[-1][0]
                if len(candidates) > limit
                else None
            )
            return (
                [self._admin_record(code) for _record_id, code in selected],
                next_cursor,
            )

    async def get_admin_work(self, code: str) -> AdminWorkRecord | None:
        async with self._lock:
            if code not in self._by_code:
                return None
            return self._admin_record(code)

    async def hide_work(
        self,
        code: str,
        *,
        reason: str,
        request_id: str,
        administrator_ip: str,
    ) -> AdminWorkRecord | None:
        async with self._lock:
            if code not in self._by_code:
                return None
            status = self._status_by_code[code]
            if status == "purged":
                raise WorkStateConflict("Purged works cannot be hidden")
            if status == "active":
                now = datetime.now(timezone.utc)
                self._status_by_code[code] = "hidden"
                self._deleted_codes.add(code)
                self._moderation_by_code[code] = (now, reason, None)
                self._record_event(
                    action="work_hidden",
                    target_value=code,
                    reason=reason,
                    request_id=request_id,
                    administrator_ip=administrator_ip,
                )
            return self._admin_record(code)

    async def restore_work(
        self,
        code: str,
        *,
        reason: str | None,
        request_id: str,
        administrator_ip: str,
    ) -> AdminWorkRecord | None:
        async with self._lock:
            if code not in self._by_code:
                return None
            status = self._status_by_code[code]
            if status == "purged":
                raise WorkStateConflict("Purged works cannot be restored")
            if status == "hidden":
                self._status_by_code[code] = "active"
                self._deleted_codes.discard(code)
                self._moderation_by_code[code] = (None, None, None)
                self._record_event(
                    action="work_restored",
                    target_value=code,
                    reason=reason,
                    request_id=request_id,
                    administrator_ip=administrator_ip,
                )
            return self._admin_record(code)

    async def purge_work(
        self,
        code: str,
        *,
        reason: str,
        request_id: str,
        administrator_ip: str,
    ) -> AdminWorkRecord | None:
        async with self._lock:
            if code not in self._by_code:
                return None
            if self._status_by_code[code] == "purged":
                return self._admin_record(code)
            now = datetime.now(timezone.utc)
            self._status_by_code[code] = "purged"
            self._deleted_codes.add(code)
            self._moderation_by_code[code] = (now, reason, now)
            record = self._by_code[code]
            self._by_code[code] = WorkRecord(
                **{
                    **record.__dict__,
                    "pixel_data": b"",
                    "author_name": None,
                    "title": None,
                }
            )
            self._record_event(
                action="work_purged",
                target_value=code,
                reason=reason,
                request_id=request_id,
                administrator_ip=administrator_ip,
            )
            return self._admin_record(code)

    async def list_moderation_events(
        self,
        *,
        limit: int,
        cursor: int | None,
    ) -> tuple[list[ModerationEventRecord], int | None]:
        async with self._lock:
            candidates = [
                event
                for event in reversed(self._events)
                if cursor is None or event.event_id < cursor
            ]
            selected = candidates[:limit]
            next_cursor = (
                selected[-1].event_id
                if len(candidates) > limit
                else None
            )
            return selected, next_cursor


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
        with self._pool.connection() as connection:
            tombstoned = connection.execute(
                """
                SELECT 1
                FROM work_tombstones
                WHERE canonical_content_hash = %s
                """,
                (content_hash,),
            ).fetchone()
            if tombstoned is not None:
                raise WorkModerated("This work has been moderated")

        # Resolve records created before metadata was removed from the digest.
        # The oldest matching pixel payload owns the permanent title and author.
        with self._pool.connection() as connection:
            cursor = connection.execute(
                """
                SELECT
                    code, schema_version, palette_id, palette_version,
                    pixel_data, content_hash, author_name, title,
                    view_count, created_at, moderation_status
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
                if row[-1] != "active":
                    raise WorkModerated("This work has been moderated")
                return WorkRecord(*row[:-1])

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
                        view_count, created_at, moderation_status
                    FROM works
                    WHERE content_hash = %s
                    """,
                    (content_hash,),
                )
                row = cursor.fetchone()
                if row is not None:
                    if row[-1] != "active":
                        raise WorkModerated("This work has been moderated")
                    return WorkRecord(*row[:-1])

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
                  AND moderation_status = 'active'
                  AND deleted_at IS NULL
                RETURNING
                    code, schema_version, palette_id, palette_version,
                    pixel_data, content_hash, author_name, title,
                    view_count, created_at
                """,
                (code,),
            )
            row = cursor.fetchone()
            return WorkRecord(*row) if row is not None else None

    async def get(self, code: str) -> WorkRecord | None:
        try:
            return await asyncio.to_thread(self._get_sync, code)
        except (PsycopgError, PoolTimeout) as error:
            raise WorkStoreUnavailable("PostgreSQL read operation failed") from error

    def _get_sync(self, code: str) -> WorkRecord | None:
        with self._pool.connection() as connection:
            row = connection.execute(
                """
                SELECT
                    code, schema_version, palette_id, palette_version,
                    pixel_data, content_hash, author_name, title,
                    view_count, created_at
                FROM works
                WHERE code = %s
                  AND moderation_status = 'active'
                  AND deleted_at IS NULL
                """,
                (code,),
            ).fetchone()
            return WorkRecord(*row) if row is not None else None

    async def get_moderation_state(
        self,
        code: str,
    ) -> WorkModerationState | None:
        try:
            return await asyncio.to_thread(
                self._get_moderation_state_sync,
                code,
            )
        except (PsycopgError, PoolTimeout) as error:
            raise WorkStoreUnavailable(
                "PostgreSQL moderation state read failed"
            ) from error

    def _get_moderation_state_sync(
        self,
        code: str,
    ) -> WorkModerationState | None:
        with self._pool.connection() as connection:
            row = connection.execute(
                """
                SELECT moderation_status, moderation_reason
                FROM works
                WHERE code = %s
                """,
                (code,),
            ).fetchone()
            return WorkModerationState(*row) if row is not None else None

    async def delete_work(self, code: str, reason: str | None) -> bool:
        try:
            record = await asyncio.to_thread(
                self._hide_work_sync,
                code,
                reason or "Removed by administrator",
                "legacy-delete",
                "127.0.0.1",
            )
            return record is not None
        except (PsycopgError, PoolTimeout) as error:
            raise WorkStoreUnavailable("PostgreSQL delete operation failed") from error

    @staticmethod
    def _admin_record_from_row(row) -> AdminWorkRecord:
        return AdminWorkRecord(*row)

    async def list_admin_works(
        self,
        *,
        status: str | None,
        limit: int,
        cursor: int | None,
    ) -> tuple[list[AdminWorkRecord], int | None]:
        try:
            return await asyncio.to_thread(
                self._list_admin_works_sync,
                status,
                limit,
                cursor,
            )
        except (PsycopgError, PoolTimeout) as error:
            raise WorkStoreUnavailable(
                "PostgreSQL administration list operation failed"
            ) from error

    def _list_admin_works_sync(
        self,
        status: str | None,
        limit: int,
        cursor: int | None,
    ) -> tuple[list[AdminWorkRecord], int | None]:
        with self._pool.connection() as connection:
            if status is None:
                rows = connection.execute(
                    """
                    SELECT
                        id, code, schema_version, palette_id, palette_version,
                        pixel_data, author_name, title, view_count, created_at,
                        moderation_status, moderated_at, moderation_reason,
                        purged_at
                    FROM works
                    WHERE (%s::bigint IS NULL OR id < %s)
                    ORDER BY id DESC
                    LIMIT %s
                    """,
                    (cursor, cursor, limit + 1),
                ).fetchall()
            else:
                rows = connection.execute(
                    """
                    SELECT
                        id, code, schema_version, palette_id, palette_version,
                        pixel_data, author_name, title, view_count, created_at,
                        moderation_status, moderated_at, moderation_reason,
                        purged_at
                    FROM works
                    WHERE moderation_status = %s
                      AND (%s::bigint IS NULL OR id < %s)
                    ORDER BY id DESC
                    LIMIT %s
                    """,
                    (status, cursor, cursor, limit + 1),
                ).fetchall()
            selected = rows[:limit]
            next_cursor = selected[-1][0] if len(rows) > limit else None
            return (
                [
                    self._admin_record_from_row(row[1:])
                    for row in selected
                ],
                next_cursor,
            )

    async def get_admin_work(self, code: str) -> AdminWorkRecord | None:
        try:
            return await asyncio.to_thread(self._get_admin_work_sync, code)
        except (PsycopgError, PoolTimeout) as error:
            raise WorkStoreUnavailable(
                "PostgreSQL administration read operation failed"
            ) from error

    def _get_admin_work_sync(self, code: str) -> AdminWorkRecord | None:
        with self._pool.connection() as connection:
            row = connection.execute(
                """
                SELECT
                    code, schema_version, palette_id, palette_version,
                    pixel_data, author_name, title, view_count, created_at,
                    moderation_status, moderated_at, moderation_reason,
                    purged_at
                FROM works
                WHERE code = %s
                """,
                (code,),
            ).fetchone()
            return (
                self._admin_record_from_row(row)
                if row is not None
                else None
            )

    @staticmethod
    def _insert_moderation_event(
        connection,
        *,
        action: str,
        target_value: str,
        reason: str | None,
        request_id: str,
        administrator_ip: str,
    ) -> None:
        connection.execute(
            """
            INSERT INTO moderation_events (
                action, target_type, target_value, reason,
                request_id, administrator_ip
            )
            VALUES (%s, 'work', %s, %s, %s, %s::inet)
            """,
            (
                action,
                target_value,
                reason,
                request_id,
                administrator_ip,
            ),
        )

    async def hide_work(
        self,
        code: str,
        *,
        reason: str,
        request_id: str,
        administrator_ip: str,
    ) -> AdminWorkRecord | None:
        try:
            return await asyncio.to_thread(
                self._hide_work_sync,
                code,
                reason,
                request_id,
                administrator_ip,
            )
        except (PsycopgError, PoolTimeout) as error:
            raise WorkStoreUnavailable(
                "PostgreSQL hide operation failed"
            ) from error

    def _hide_work_sync(
        self,
        code: str,
        reason: str,
        request_id: str,
        administrator_ip: str,
    ) -> AdminWorkRecord | None:
        with self._pool.connection() as connection:
            row = connection.execute(
                """
                SELECT moderation_status
                FROM works
                WHERE code = %s
                FOR UPDATE
                """,
                (code,),
            ).fetchone()
            if row is None:
                return None
            if row[0] == "purged":
                raise WorkStateConflict("Purged works cannot be hidden")
            if row[0] == "active":
                connection.execute(
                    """
                    UPDATE works
                    SET
                        moderation_status = 'hidden',
                        moderated_at = CURRENT_TIMESTAMP,
                        moderation_reason = %s,
                        deleted_at = CURRENT_TIMESTAMP,
                        deleted_reason = %s
                    WHERE code = %s
                    """,
                    (reason, reason[:200], code),
                )
                self._insert_moderation_event(
                    connection,
                    action="work_hidden",
                    target_value=code,
                    reason=reason,
                    request_id=request_id,
                    administrator_ip=administrator_ip,
                )
            return self._get_admin_work_with_connection(connection, code)

    async def restore_work(
        self,
        code: str,
        *,
        reason: str | None,
        request_id: str,
        administrator_ip: str,
    ) -> AdminWorkRecord | None:
        try:
            return await asyncio.to_thread(
                self._restore_work_sync,
                code,
                reason,
                request_id,
                administrator_ip,
            )
        except (PsycopgError, PoolTimeout) as error:
            raise WorkStoreUnavailable(
                "PostgreSQL restore operation failed"
            ) from error

    def _restore_work_sync(
        self,
        code: str,
        reason: str | None,
        request_id: str,
        administrator_ip: str,
    ) -> AdminWorkRecord | None:
        with self._pool.connection() as connection:
            row = connection.execute(
                """
                SELECT moderation_status
                FROM works
                WHERE code = %s
                FOR UPDATE
                """,
                (code,),
            ).fetchone()
            if row is None:
                return None
            if row[0] == "purged":
                raise WorkStateConflict("Purged works cannot be restored")
            if row[0] == "hidden":
                connection.execute(
                    """
                    UPDATE works
                    SET
                        moderation_status = 'active',
                        moderated_at = NULL,
                        moderation_reason = NULL,
                        deleted_at = NULL,
                        deleted_reason = NULL
                    WHERE code = %s
                    """,
                    (code,),
                )
                self._insert_moderation_event(
                    connection,
                    action="work_restored",
                    target_value=code,
                    reason=reason,
                    request_id=request_id,
                    administrator_ip=administrator_ip,
                )
            return self._get_admin_work_with_connection(connection, code)

    async def purge_work(
        self,
        code: str,
        *,
        reason: str,
        request_id: str,
        administrator_ip: str,
    ) -> AdminWorkRecord | None:
        try:
            return await asyncio.to_thread(
                self._purge_work_sync,
                code,
                reason,
                request_id,
                administrator_ip,
            )
        except (PsycopgError, PoolTimeout) as error:
            raise WorkStoreUnavailable(
                "PostgreSQL purge operation failed"
            ) from error

    def _purge_work_sync(
        self,
        code: str,
        reason: str,
        request_id: str,
        administrator_ip: str,
    ) -> AdminWorkRecord | None:
        with self._pool.connection() as connection:
            row = connection.execute(
                """
                SELECT
                    moderation_status, content_hash, schema_version,
                    palette_id, palette_version, pixel_data
                FROM works
                WHERE code = %s
                FOR UPDATE
                """,
                (code,),
            ).fetchone()
            if row is None:
                return None
            if row[0] == "purged":
                return self._get_admin_work_with_connection(connection, code)
            canonical_hash = canonical_content_digest(
                schema_version=row[2],
                palette_id=row[3],
                palette_version=row[4],
                pixel_data=row[5],
            )
            connection.execute(
                """
                INSERT INTO work_tombstones (
                    code, canonical_content_hash, schema_version,
                    palette_id, palette_version, reason
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                """,
                (
                    code,
                    canonical_hash,
                    row[2],
                    row[3],
                    row[4],
                    reason,
                ),
            )
            connection.execute(
                """
                UPDATE works
                SET
                    moderation_status = 'purged',
                    moderated_at = CURRENT_TIMESTAMP,
                    moderation_reason = %s,
                    purged_at = CURRENT_TIMESTAMP,
                    deleted_at = CURRENT_TIMESTAMP,
                    deleted_reason = %s,
                    pixel_data = NULL,
                    author_name = NULL,
                    title = NULL
                WHERE code = %s
                """,
                (reason, reason[:200], code),
            )
            self._insert_moderation_event(
                connection,
                action="work_purged",
                target_value=code,
                reason=reason,
                request_id=request_id,
                administrator_ip=administrator_ip,
            )
            return self._get_admin_work_with_connection(connection, code)

    def _get_admin_work_with_connection(
        self,
        connection,
        code: str,
    ) -> AdminWorkRecord:
        row = connection.execute(
            """
            SELECT
                code, schema_version, palette_id, palette_version,
                pixel_data, author_name, title, view_count, created_at,
                moderation_status, moderated_at, moderation_reason,
                purged_at
            FROM works
            WHERE code = %s
            """,
            (code,),
        ).fetchone()
        return self._admin_record_from_row(row)

    async def list_moderation_events(
        self,
        *,
        limit: int,
        cursor: int | None,
    ) -> tuple[list[ModerationEventRecord], int | None]:
        try:
            return await asyncio.to_thread(
                self._list_moderation_events_sync,
                limit,
                cursor,
            )
        except (PsycopgError, PoolTimeout) as error:
            raise WorkStoreUnavailable(
                "PostgreSQL moderation event list failed"
            ) from error

    def _list_moderation_events_sync(
        self,
        limit: int,
        cursor: int | None,
    ) -> tuple[list[ModerationEventRecord], int | None]:
        with self._pool.connection() as connection:
            rows = connection.execute(
                """
                SELECT
                    id, action, target_type, target_value, reason,
                    request_id, host(administrator_ip), created_at
                FROM moderation_events
                WHERE (%s::bigint IS NULL OR id < %s)
                ORDER BY id DESC
                LIMIT %s
                """,
                (cursor, cursor, limit + 1),
            ).fetchall()
            selected = rows[:limit]
            next_cursor = selected[-1][0] if len(rows) > limit else None
            return (
                [ModerationEventRecord(*row) for row in selected],
                next_cursor,
            )

    async def is_client_banned(self, client_ip: str) -> bool:
        try:
            return await asyncio.to_thread(self._is_client_banned_sync, client_ip)
        except (PsycopgError, PoolTimeout) as error:
            raise WorkStoreUnavailable("PostgreSQL ban lookup failed") from error

    def _is_client_banned_sync(self, client_ip: str) -> bool:
        with self._pool.connection() as connection:
            row = connection.execute(
                "SELECT 1 FROM client_bans WHERE client_ip = %s::inet",
                (client_ip,),
            ).fetchone()
            return row is not None

    async def ban_client(self, client_ip: str, reason: str | None) -> None:
        try:
            await asyncio.to_thread(self._ban_client_sync, client_ip, reason)
        except (PsycopgError, PoolTimeout) as error:
            raise WorkStoreUnavailable("PostgreSQL ban operation failed") from error

    def _ban_client_sync(self, client_ip: str, reason: str | None) -> None:
        with self._pool.connection() as connection:
            connection.execute(
                """
                INSERT INTO client_bans (client_ip, reason)
                VALUES (%s::inet, %s)
                ON CONFLICT (client_ip) DO UPDATE
                SET reason = EXCLUDED.reason, created_at = CURRENT_TIMESTAMP
                """,
                (client_ip, reason),
            )

    async def unban_client(self, client_ip: str) -> None:
        try:
            await asyncio.to_thread(self._unban_client_sync, client_ip)
        except (PsycopgError, PoolTimeout) as error:
            raise WorkStoreUnavailable("PostgreSQL unban operation failed") from error

    def _unban_client_sync(self, client_ip: str) -> None:
        with self._pool.connection() as connection:
            connection.execute(
                "DELETE FROM client_bans WHERE client_ip = %s::inet",
                (client_ip,),
            )


def create_work_store(database_url: str | None) -> WorkStore:
    if not database_url:
        return UnavailableWorkStore()
    return PostgresWorkStore(database_url)
