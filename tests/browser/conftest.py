from __future__ import annotations

import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import pytest
from playwright.sync_api import Browser, Page, sync_playwright


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


@pytest.fixture(scope="session")
def editor_base_url() -> Iterator[str]:
    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.api.app:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],
        cwd=PROJECT_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )

    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Tourgrid Studio test server exited before startup.")
        try:
            with urllib.request.urlopen(
                f"{base_url}/api/v1/health", timeout=1
            ) as response:
                if response.status == 200:
                    break
        except (OSError, urllib.error.URLError):
            time.sleep(0.1)
    else:
        process.terminate()
        raise RuntimeError("Timed out while starting the browser test server.")

    yield base_url

    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


@pytest.fixture(scope="session")
def chromium_browser() -> Iterator[Browser]:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture()
def editor_page(
    chromium_browser: Browser,
    editor_base_url: str,
) -> Iterator[Page]:
    context = chromium_browser.new_context(
        viewport={"width": 1600, "height": 1000},
        accept_downloads=True,
    )
    page = context.new_page()
    runtime_errors: list[str] = []

    page.on("pageerror", lambda error: runtime_errors.append(str(error)))
    page.on(
        "console",
        lambda message: (
            runtime_errors.append(message.text)
            if message.type == "error"
            else None
        ),
    )

    page.goto(f"{editor_base_url}/?test=1", wait_until="domcontentloaded")
    page.wait_for_function(
        "() => window.__TOURGRID_TEST__?.isReady === true"
    )
    page.locator("#announcementModal.show").wait_for(state="visible")
    page.locator(".announcement-close-btn").click()
    page.locator("#announcementModal").wait_for(state="hidden")
    yield page

    context.close()
    assert runtime_errors == []
