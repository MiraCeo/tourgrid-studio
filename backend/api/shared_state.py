from __future__ import annotations

import asyncio
import time
from collections import OrderedDict, deque
from dataclasses import dataclass
from typing import Protocol

try:
    import redis.asyncio as redis
    from redis.exceptions import RedisError
except ImportError:  # pragma: no cover - production dependency guard
    redis = None
    RedisError = Exception


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after_seconds: int


class SharedStateUnavailable(RuntimeError):
    pass


class SharedState(Protocol):
    async def initialize(self) -> None: ...

    async def close(self) -> None: ...

    async def check_rate_limit(
        self,
        key: str,
        *,
        limit: int,
        window_seconds: float,
    ) -> RateLimitResult: ...

    async def claim_view(
        self,
        code: str,
        viewer_id: str,
        ttl_seconds: int,
    ) -> bool: ...

    async def ban_temporarily(self, client_ip: str, ttl_seconds: int) -> None: ...

    async def unban_temporarily(self, client_ip: str) -> None: ...

    async def is_temporarily_banned(self, client_ip: str) -> bool: ...


class InMemorySharedState:
    """Single-process fallback for source runs and tests."""

    def __init__(self, max_clients: int = 10_000) -> None:
        self.max_clients = max_clients
        self._requests: OrderedDict[str, deque[float]] = OrderedDict()
        self._views: dict[str, float] = {}
        self._bans: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def initialize(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def check_rate_limit(
        self,
        key: str,
        *,
        limit: int,
        window_seconds: float,
    ) -> RateLimitResult:
        current = time.monotonic()
        cutoff = current - window_seconds
        async with self._lock:
            for client, entries in list(self._requests.items()):
                while entries and entries[0] <= cutoff:
                    entries.popleft()
                if not entries:
                    del self._requests[client]

            entries = self._requests.get(key)
            if entries is None:
                if len(self._requests) >= self.max_clients:
                    self._requests.popitem(last=False)
                entries = deque()
                self._requests[key] = entries
            else:
                self._requests.move_to_end(key)

            if len(entries) >= limit:
                retry_after = max(
                    1,
                    int(entries[0] + window_seconds - current + 0.999),
                )
                return RateLimitResult(False, 0, retry_after)
            entries.append(current)
            return RateLimitResult(True, max(0, limit - len(entries)), 0)

    async def claim_view(
        self,
        code: str,
        viewer_id: str,
        ttl_seconds: int,
    ) -> bool:
        current = time.monotonic()
        key = f"{code}:{viewer_id}"
        async with self._lock:
            for view_key, expires_at in list(self._views.items()):
                if expires_at <= current:
                    del self._views[view_key]
            if self._views.get(key, 0) > current:
                return False
            self._views[key] = current + ttl_seconds
            return True

    async def ban_temporarily(self, client_ip: str, ttl_seconds: int) -> None:
        async with self._lock:
            self._bans[client_ip] = time.monotonic() + ttl_seconds

    async def unban_temporarily(self, client_ip: str) -> None:
        async with self._lock:
            self._bans.pop(client_ip, None)

    async def is_temporarily_banned(self, client_ip: str) -> bool:
        current = time.monotonic()
        async with self._lock:
            expires_at = self._bans.get(client_ip)
            if expires_at is None:
                return False
            if expires_at <= current:
                del self._bans[client_ip]
                return False
            return True


class RedisSharedState:
    _RATE_LIMIT_SCRIPT = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
"""

    def __init__(self, redis_url: str) -> None:
        if redis is None:
            raise RuntimeError(
                "Redis dependencies are not installed; install redis"
            )
        self._client = redis.from_url(
            redis_url,
            encoding="utf-8",
            decode_responses=True,
        )

    async def initialize(self) -> None:
        try:
            await self._client.ping()
        except RedisError as error:
            raise SharedStateUnavailable("Redis is unavailable") from error

    async def close(self) -> None:
        await self._client.aclose()

    async def check_rate_limit(
        self,
        key: str,
        *,
        limit: int,
        window_seconds: float,
    ) -> RateLimitResult:
        window_ms = max(1, round(window_seconds * 1000))
        redis_key = f"tourgrid:rate:publish:{key}"
        try:
            current, ttl_ms = await self._client.eval(
                self._RATE_LIMIT_SCRIPT,
                1,
                redis_key,
                window_ms,
            )
        except RedisError as error:
            raise SharedStateUnavailable("Redis rate limit failed") from error
        allowed = int(current) <= limit
        return RateLimitResult(
            allowed,
            max(0, limit - int(current)),
            0 if allowed else max(1, (int(ttl_ms) + 999) // 1000),
        )

    async def claim_view(
        self,
        code: str,
        viewer_id: str,
        ttl_seconds: int,
    ) -> bool:
        try:
            claimed = await self._client.set(
                f"tourgrid:view:{code}:{viewer_id}",
                "1",
                ex=ttl_seconds,
                nx=True,
            )
        except RedisError as error:
            raise SharedStateUnavailable("Redis view deduplication failed") from error
        return bool(claimed)

    async def ban_temporarily(self, client_ip: str, ttl_seconds: int) -> None:
        try:
            await self._client.set(
                f"tourgrid:ban:{client_ip}",
                "1",
                ex=ttl_seconds,
            )
        except RedisError as error:
            raise SharedStateUnavailable("Redis temporary ban failed") from error

    async def unban_temporarily(self, client_ip: str) -> None:
        try:
            await self._client.delete(f"tourgrid:ban:{client_ip}")
        except RedisError as error:
            raise SharedStateUnavailable("Redis temporary unban failed") from error

    async def is_temporarily_banned(self, client_ip: str) -> bool:
        try:
            return bool(await self._client.exists(f"tourgrid:ban:{client_ip}"))
        except RedisError as error:
            raise SharedStateUnavailable("Redis ban lookup failed") from error


def create_shared_state(
    redis_url: str | None,
    *,
    max_clients: int,
) -> SharedState:
    if redis_url:
        return RedisSharedState(redis_url)
    return InMemorySharedState(max_clients=max_clients)
