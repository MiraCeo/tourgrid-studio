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
        "LICENSE",
        "NOTICE",
        "LICENSE_SCOPE.md",
        "THIRD_PARTY_NOTICES.md",
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
    assert caddyfile.index("reverse_proxy @backend") < caddyfile.index("file_server")
    assert "root * /srv" in caddyfile
    assert "file_server" in caddyfile
    assert "try_files" not in caddyfile
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


def test_frontend_image_includes_only_versioned_frontend_sources() -> None:
    dockerfile = (ROOT / "docker/frontend.Dockerfile").read_text(encoding="utf-8")

    assert "COPY frontend/css /srv/static/css" in dockerfile
    assert "COPY frontend/js /srv/static/js" in dockerfile
    assert "COPY frontend/admin /srv/admin" in dockerfile
    assert "COPY frontend/assets" not in dockerfile


def test_admin_interface_has_strict_no_store_proxy_policy() -> None:
    caddyfile = (ROOT / "docker/Caddyfile").read_text(encoding="utf-8")

    assert "@admin path /admin /admin/*" in caddyfile
    assert 'Cache-Control "no-store"' in caddyfile
    assert 'X-Robots-Tag "noindex, nofollow"' in caddyfile
    admin_policy = caddyfile.split("header @admin", maxsplit=1)[1].split(
        "route {",
        maxsplit=1,
    )[0]
    assert "'unsafe-inline'" not in admin_policy


def test_license_scope_excludes_palette_data_and_starts_at_v031() -> None:
    project = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    scope = (ROOT / "LICENSE_SCOPE.md").read_text(encoding="utf-8")
    notices = (ROOT / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")

    assert 'version = "0.3.1"' in project
    assert 'license = "Apache-2.0"' in project
    assert "`v0.3.1`" in scope
    assert "`palettes/`" in scope
    assert "`frontend/js/natural-64-v1.js`" in scope
    assert "official promotional" in notices
    assert "broadcast footage" in notices


def test_rate_limiter_client_cap_is_configured_for_deployment() -> None:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    production = (ROOT / "deploy/production.env.example").read_text(encoding="utf-8")
    staging = (ROOT / "deploy/staging.env.example").read_text(encoding="utf-8")

    assert "TOURGRID_RATE_LIMIT_MAX_CLIENTS" in compose
    assert "TOURGRID_RATE_LIMIT_MAX_CLIENTS=10000" in production
    assert "TOURGRID_RATE_LIMIT_MAX_CLIENTS=10000" in staging


def test_redis_and_independent_admin_credentials_are_configured() -> None:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    production = (ROOT / "deploy/production.env.example").read_text(
        encoding="utf-8"
    )

    assert "redis:7.4-alpine" in compose
    assert "TOURGRID_REDIS_URL: redis://redis:6379/0" in compose
    assert "TOURGRID_VIEW_DEDUPE_SECONDS" in compose
    assert "TOURGRID_ADMIN_TOKEN=" in production
    assert (
        "TOURGRID_ADMIN_TOKEN=replace-with-a-different-long-random-token"
        in production
    )


def test_production_image_is_non_root_and_has_healthcheck() -> None:
    dockerfile = (ROOT / "docker/api.Dockerfile").read_text(encoding="utf-8")

    assert "USER tourgrid" in dockerfile
    assert "HEALTHCHECK" in dockerfile
    assert "--host\", \"0.0.0.0\"" in dockerfile
    assert "--forwarded-allow-ips=*\"" in dockerfile
    assert "requirements-prod.lock" in dockerfile
    assert "pip install --prefix=/install --no-deps ." not in dockerfile


def test_project_is_run_from_source_checkout_instead_of_wheel_entrypoint() -> None:
    project = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    module_entrypoint = (ROOT / "backend/__main__.py").read_text(encoding="utf-8")
    workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")

    assert "[project.scripts]" not in project
    assert "tourgrid-api" not in project
    assert "只支持从完整的源码仓库运行" in readme
    assert "python.exe -m backend" in readme
    assert "from .api.app import run" in module_entrypoint
    assert 'pip install -e ".[dev]"' not in workflow
    assert "pip install --requirement requirements.lock" in workflow


def test_production_lock_excludes_server_conversion_dependencies() -> None:
    lock = (ROOT / "requirements-prod.lock").read_text(encoding="utf-8")

    forbidden = [
        "pyxelate",
        "numpy==",
        "pillow==",
        "scipy==",
        "scikit-image==",
        "scikit-learn==",
        "numba==",
        "matplotlib==",
        "python-multipart==",
    ]
    assert all(package not in lock.lower() for package in forbidden)


def test_palette_examples_never_replace_the_provisional_palette() -> None:
    deployment = (ROOT / "docs/deployment.md").read_text(encoding="utf-8")

    assert "natural-64-v1" in deployment
    assert "official-v1" in deployment
    assert "不能覆盖" in deployment


def test_server_converter_removal_is_documented_as_complete() -> None:
    limitations = (ROOT / "docs/known-limitations.md").read_text(
        encoding="utf-8"
    )

    assert "服务器图片转换子系统已经移除" in limitations
    assert "浏览器本地转换" in limitations


def test_container_no_longer_carries_conversion_runtime_packages() -> None:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    dockerfile = (ROOT / "docker/api.Dockerfile").read_text(encoding="utf-8")
    caddyfile = (ROOT / "docker/Caddyfile").read_text(encoding="utf-8")

    assert "libgomp1" not in dockerfile
    assert "apt-get install --yes --no-install-recommends git" not in dockerfile
    assert "TOURGRID_MAX_UPLOAD_BYTES" not in compose
    assert "TOURGRID_MAX_CONCURRENT_CONVERSIONS" not in compose
    assert "/tmp:size=32m" in compose
    assert "128KB" in caddyfile
