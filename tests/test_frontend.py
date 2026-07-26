from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
EDITOR_HTML = PROJECT_ROOT / "像素画编辑器.html"


def editor_source() -> str:
    return EDITOR_HTML.read_text(encoding="utf-8")


def test_server_conversion_is_the_default_import_path() -> None:
    source = editor_source()

    assert '<option value="server" selected>' in source
    assert '<option value="none" selected>' in source
    assert "new FormData()" in source
    assert "new AbortController()" in source
    assert "await confirmCropServer()" in source
    assert "validateHexPixels(payload)" in source
    assert "data.hexPixels" in source


def test_local_converter_is_explicit_fallback() -> None:
    source = editor_source()

    assert '<option value="local">' in source
    assert "confirmCropLocal()" in source
    assert "ditherMode === 'floyd'" in source
    assert "viewMode" not in source
    assert "canvasPixelData" not in source


def test_exports_include_raw_and_nearest_neighbor_preview() -> None:
    source = editor_source()

    assert "exportRawPixelImage()" in source
    assert "exportPixelPreview()" in source
    assert "buildPixelExportCanvas(1)" in source
    assert "var scale = 16" in source
    assert "buildPixelExportCanvas(scale)" in source
    assert "outputCtx.imageSmoothingEnabled = false" in source


def test_inline_javascript_has_valid_syntax() -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not installed")

    source = editor_source()
    matches = re.findall(r"<script>(.*?)</script>", source, flags=re.DOTALL)
    assert matches, "editor must contain an inline script"
    result = subprocess.run(
        [node, "--check", "-"],
        input="\n".join(matches).encode("utf-8"),
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", errors="replace")
