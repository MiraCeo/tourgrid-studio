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

    api_service = compose.split("\n  web:", maxsplit=1)[0]
    assert "expose:" in api_service
    assert "ports:" not in api_service
    assert "/api/*" in caddyfile
    assert "reverse_proxy @backend api:8000" in caddyfile
    assert caddyfile.index("route {") < caddyfile.index("reverse_proxy @backend")
    assert caddyfile.index("reverse_proxy @backend") < caddyfile.index("try_files")
    assert "root * /srv" in caddyfile
    assert "file_server" in caddyfile
    assert "script-src 'self' 'unsafe-inline'" in caddyfile


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
