from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_container_and_compose_delivery_files_exist() -> None:
    expected = [
        ".dockerignore",
        "compose.yaml",
        "docker/api.Dockerfile",
        "docker/frontend.Dockerfile",
        "docker/Caddyfile",
        "docker/uvicorn-logging.json",
        "requirements-prod.lock",
        "deploy/.env.example",
        "deploy/staging.env.example",
        "deploy/production.env.example",
        "docs/deployment.md",
    ]
    assert all((ROOT / path).is_file() for path in expected)


def test_api_is_not_published_directly_and_proxy_routes_same_origin() -> None:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    caddyfile = (ROOT / "docker/Caddyfile").read_text(encoding="utf-8")

    api_service = compose.split("\n  api:", maxsplit=1)[1].split(
        "\n  web:",
        maxsplit=1,
    )[0]
    assert "expose:" in api_service
    assert "ports:" not in api_service
    assert "/api/*" in caddyfile
    assert "reverse_proxy @backend api:8000" in caddyfile
    assert caddyfile.index("route {") < caddyfile.index("reverse_proxy @backend")
    assert caddyfile.index("reverse_proxy @backend") < caddyfile.index("try_files")
    assert "root * /srv" in caddyfile
    assert "file_server" in caddyfile
    assert "script-src 'self' 'unsafe-inline'" in caddyfile


def test_postgres_is_persistent_and_only_bound_to_loopback() -> None:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    production = (ROOT / "deploy/production.env.example").read_text(
        encoding="utf-8"
    )

    assert "postgres:17-alpine" in compose
    assert "postgres_data:/var/lib/postgresql/data" in compose
    assert '127.0.0.1:${TOURGRID_DB_PORT:-5432}:5432' in compose
    assert "TOURGRID_DATABASE_URL:" in compose
    assert "condition: service_healthy" in compose
    assert "TOURGRID_DB_PASSWORD=" in production


def test_frontend_image_includes_static_assets() -> None:
    dockerfile = (ROOT / "docker/frontend.Dockerfile").read_text(encoding="utf-8")

    assert "COPY frontend/assets /srv/static/assets" in dockerfile


def test_rate_limiter_client_cap_is_configured_for_deployment() -> None:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    production = (ROOT / "deploy/production.env.example").read_text(encoding="utf-8")
    staging = (ROOT / "deploy/staging.env.example").read_text(encoding="utf-8")

    assert "TOURGRID_RATE_LIMIT_MAX_CLIENTS" in compose
    assert "TOURGRID_RATE_LIMIT_MAX_CLIENTS=10000" in production
    assert "TOURGRID_RATE_LIMIT_MAX_CLIENTS=10000" in staging


def test_production_image_is_non_root_and_has_healthcheck() -> None:
    dockerfile = (ROOT / "docker/api.Dockerfile").read_text(encoding="utf-8")

    assert "USER tourgrid" in dockerfile
    assert "HEALTHCHECK" in dockerfile
    assert "--host\", \"0.0.0.0\"" in dockerfile
    assert "--forwarded-allow-ips=*\"" in dockerfile
    assert "requirements-prod.lock" in dockerfile


def test_production_lock_pins_pyxelate_to_immutable_commit() -> None:
    lock = (ROOT / "requirements-prod.lock").read_text(encoding="utf-8")

    assert (
        "pyxelate @ git+https://github.com/sedthh/pyxelate.git@"
        "f4a046b8b148370a20ab7681fce160551e5fc49b"
    ) in lock


def test_palette_examples_never_replace_the_provisional_palette() -> None:
    deployment = (ROOT / "docs/deployment.md").read_text(encoding="utf-8")

    assert "natural-64-v1" in deployment
    assert "official-v1" in deployment
    assert "不能覆盖" in deployment


def test_server_converter_removal_is_guarded_by_backup_checklist() -> None:
    limitations = (ROOT / "docs/known-limitations.md").read_text(
        encoding="utf-8"
    )

    assert "延后移除服务器图片转换子系统" in limitations
    assert "不得只删除 `convert_image.py`" in limitations
    assert "PostgreSQL 作品数据" in limitations
    assert "requirements-prod.lock" in limitations
