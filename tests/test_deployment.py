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
    assert "script-src 'self'; script-src-attr 'none'" in caddyfile
    assert "health_uri /api/v1/ready" in caddyfile
    assert "http://127.0.0.1:2015" in caddyfile


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


def test_local_and_production_proxy_ports_are_loopback_only() -> None:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    local = (ROOT / "deploy/.env.example").read_text(encoding="utf-8")
    staging = (ROOT / "deploy/staging.env.example").read_text(encoding="utf-8")
    production = (ROOT / "deploy/production.env.example").read_text(
        encoding="utf-8"
    )

    assert (
        '"${TOURGRID_BIND_ADDRESS:-127.0.0.1}:'
        '${TOURGRID_HTTP_PORT:-8080}:80"'
    ) in compose
    assert (
        '"${TOURGRID_BIND_ADDRESS:-127.0.0.1}:'
        '${TOURGRID_HTTPS_PORT:-8443}:443"'
    ) in compose
    assert "TOURGRID_BIND_ADDRESS=127.0.0.1" in local
    assert "TOURGRID_BIND_ADDRESS=0.0.0.0" in staging
    assert "TOURGRID_SITE_ADDRESS=:80" in production
    assert "TOURGRID_BIND_ADDRESS=127.0.0.1" in production
    assert "TOURGRID_HTTP_PORT=8081" in production


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

    assert 'version = "0.3.2"' in project
    assert 'license = "Apache-2.0"' in project
    assert "`v0.3.1`" in scope
    assert "`palettes/`" in scope
    assert "`frontend/js/official-40-v1.js`" in scope
    assert "`frontend/js/natural-64-v2.js`" in scope
    assert "official promotional" in notices
    assert "broadcast footage" in notices


def test_rate_limiter_client_cap_is_configured_for_deployment() -> None:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    production = (ROOT / "deploy/production.env.example").read_text(encoding="utf-8")
    staging = (ROOT / "deploy/staging.env.example").read_text(encoding="utf-8")

    assert "TOURGRID_RATE_LIMIT_MAX_CLIENTS" in compose
    assert "TOURGRID_RATE_LIMIT_REQUESTS=20" in production
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
    assert "TOURGRID_ADMIN_AUTH_FAILURE_LIMIT" in compose
    assert "TOURGRID_ADMIN_AUTH_FAILURE_WINDOW_SECONDS" in compose
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
    assert "/api/v1/ready" in dockerfile


def test_api_dependency_index_is_configurable_without_weakening_hash_checks() -> None:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    dockerfile = (ROOT / "docker/api.Dockerfile").read_text(encoding="utf-8")
    environments = [
        (ROOT / path).read_text(encoding="utf-8")
        for path in (
            "deploy/.env.example",
            "deploy/staging.env.example",
            "deploy/production.env.example",
        )
    ]

    assert (
        "PIP_INDEX_URL: "
        "${TOURGRID_PIP_INDEX_URL:-https://pypi.org/simple}"
    ) in compose
    assert "PIP_DEFAULT_TIMEOUT: ${TOURGRID_PIP_TIMEOUT:-120}" in compose
    assert "PIP_RETRIES: ${TOURGRID_PIP_RETRIES:-10}" in compose
    assert "ARG PIP_INDEX_URL=https://pypi.org/simple" in dockerfile
    assert '--index-url "${PIP_INDEX_URL}"' in dockerfile
    assert '--timeout "${PIP_DEFAULT_TIMEOUT}"' in dockerfile
    assert '--retries "${PIP_RETRIES}"' in dockerfile
    assert "--require-hashes" in dockerfile
    assert all(
        "TOURGRID_PIP_INDEX_URL=https://pypi.org/simple" in environment
        and "TOURGRID_PIP_TIMEOUT=120" in environment
        and "TOURGRID_PIP_RETRIES=10" in environment
        for environment in environments
    )


def test_all_containers_rotate_logs_and_web_has_a_healthcheck() -> None:
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")

    assert "x-logging: &default-logging" in compose
    assert compose.count("logging: *default-logging") == 4
    assert 'max-size: "10m"' in compose
    assert 'max-file: "5"' in compose
    assert "http://127.0.0.1:2015/" in compose
    assert "/api/v1/ready" in compose


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
    assert (
        "pip install --require-hashes --requirement requirements.lock"
        in workflow
    )


def test_featured_pool_migration_removes_six_work_database_limit() -> None:
    migration = (
        ROOT / "backend" / "api" / "migrations" /
        "007_expand_featured_works.sql"
    ).read_text(encoding="utf-8")

    assert "DROP CONSTRAINT IF EXISTS featured_works_position_range" in migration
    assert "ALTER COLUMN position TYPE INTEGER" in migration


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


def test_archived_palette_is_not_a_runtime_palette() -> None:
    deployment = (ROOT / "docs/deployment.md").read_text(encoding="utf-8")

    assert "natural-64-v2" in deployment
    assert "official-40-v1" in deployment
    assert "natural-64-v1" in deployment
    assert "旧作品迁移" in deployment
    assert "40种颜色" in deployment
    assert "#FFFFFF" in deployment


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


def test_ci_has_a_database_only_postgres_store_job() -> None:
    workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    project = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    postgres_tests = (
        ROOT / "tests/test_postgres_work_store.py"
    ).read_text(encoding="utf-8")

    job = workflow.split("\n  postgres-store:", maxsplit=1)[1].split(
        "\n  container-smoke:",
        maxsplit=1,
    )[0]
    assert "image: postgres:17-alpine" in job
    assert "TOURGRID_TEST_DATABASE_URL:" in job
    assert "tests/test_postgres_work_store.py" in job
    assert "-m postgres_store" in job
    assert "docker compose" not in job
    assert "playwright" not in job.lower()
    assert "postgres_store:" in project
    assert postgres_tests.count("@pytest.mark.postgres_store") == 2


def test_container_smoke_publishes_with_the_shareable_palette() -> None:
    workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")

    smoke_job = workflow.split("\n  container-smoke:", maxsplit=1)[1]
    assert "'paletteId':'official-40-v1'" in smoke_job
    assert "'paletteVersion':1" in smoke_job
    assert "'paletteId':'natural-64-v2'" not in smoke_job


def test_supply_chain_inputs_are_pinned_audited_and_auto_updated() -> None:
    workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    api_dockerfile = (ROOT / "docker/api.Dockerfile").read_text(
        encoding="utf-8"
    )
    frontend_dockerfile = (ROOT / "docker/frontend.Dockerfile").read_text(
        encoding="utf-8"
    )
    dependabot = (ROOT / ".github/dependabot.yml").read_text(encoding="utf-8")
    production_lock = (ROOT / "requirements-prod.lock").read_text(
        encoding="utf-8"
    )
    development_lock = (ROOT / "requirements.lock").read_text(
        encoding="utf-8"
    )

    assert workflow.count("actions/checkout@11d5960a326750d5838078e36cf38b85af677262") == 4
    assert workflow.count("actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065") == 3
    assert "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25" in workflow
    assert "python -m pip_audit" in workflow
    assert "continue-on-error: true" in workflow
    assert "--require-hashes" in workflow
    assert "@sha256:" in compose
    assert "@sha256:" in api_dockerfile
    assert "@sha256:" in frontend_dockerfile
    assert "--require-hashes" in api_dockerfile
    assert "--hash=sha256:" in production_lock
    assert "--hash=sha256:" in development_lock
    assert dependabot.count("package-ecosystem:") == 4
