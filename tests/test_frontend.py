from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = PROJECT_ROOT / "frontend"
INDEX_HTML = FRONTEND_ROOT / "index.html"
JAVASCRIPT_ROOT = FRONTEND_ROOT / "js"


def read_frontend() -> str:
    sources = [INDEX_HTML.read_text(encoding="utf-8")]
    sources.extend(
        path.read_text(encoding="utf-8")
        for path in sorted((FRONTEND_ROOT / "css").glob("*.css"))
    )
    sources.extend(
        path.read_text(encoding="utf-8")
        for path in sorted(JAVASCRIPT_ROOT.glob("*.js"))
    )
    return "\n".join(sources)


def run_node(script: str, *arguments: Path) -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not installed")
    result = subprocess.run(
        [node, "-e", script, *(str(path) for path in arguments)],
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr.decode("utf-8", errors="replace")


def test_frontend_is_split_into_ordered_assets() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")

    assert '<link rel="stylesheet" href="/static/css/editor.css">' in html
    expected_scripts = [
        "storage.js",
        "conversion-api.js",
        "state.js",
        "editor.js",
        "export.js",
        "import.js",
        "app.js",
    ]
    positions = [
        html.index(f'<script src="/static/js/{name}"></script>')
        for name in expected_scripts
    ]
    assert positions == sorted(positions)
    assert not (PROJECT_ROOT / "像素画编辑器.html").exists()


def test_server_conversion_is_the_default_import_path() -> None:
    source = read_frontend()

    assert '<option value="server" selected>' in source
    assert '<option value="none" selected>' in source
    assert "new FormData()" in source
    assert "new AbortController()" in source
    assert "await confirmCropServer()" in source
    assert "TourgridConversion.validateHexPixels" in source
    assert "data.hexPixels" in source
    assert "if (!cropImg || conversionInProgress) return" in source


def test_local_converter_is_explicit_fallback() -> None:
    source = read_frontend()

    assert '<option value="local">' in source
    assert "confirmCropLocal()" in source
    assert "ditherMode === 'floyd'" in source
    assert "viewMode" not in source
    assert "canvasPixelData" not in source


def test_import_ui_supports_retry_status_and_touch_crop() -> None:
    source = read_frontend()

    assert 'id="conversionRetryBtn"' in source
    assert "showRetry ? 'inline-flex' : 'none'" in source
    assert "正在上传裁切图片" in source
    assert "服务器正在转换" in source
    assert "onCropTouchStart" in source
    assert "onCropTouchMove" in source
    assert "touch-action: none" in source


def test_exports_include_raw_and_nearest_neighbor_preview() -> None:
    source = read_frontend()

    assert "exportRawPixelImage()" in source
    assert "exportPixelPreview()" in source
    assert "buildPixelExportCanvas(1)" in source
    assert "var scale = 16" in source
    assert "buildPixelExportCanvas(scale)" in source
    assert "outputCtx.imageSmoothingEnabled = false" in source


def test_storage_migrates_old_documents_and_rejects_invalid_pixels() -> None:
    script = r"""
const assert = require('node:assert/strict');
const storage = require(process.argv[1]);
const pixels = Array.from({length: 2}, () => ['#ffffff', '#000000']);
const migrated = storage.migrate({
  gridSize: 2,
  pixels,
  paletteId: 'mard',
  savedAt: '2026-01-01T00:00:00.000Z'
});
assert.equal(migrated.schemaVersion, 3);
assert.equal(migrated.metadata.editorPaletteId, 'mard');
assert.equal(migrated.metadata.sourceMode, 'canvas');
assert.equal(migrated.pixels[0][0], '#FFFFFF');
assert.equal(storage.migrate({gridSize: 2, pixels: [['#fff']]}), null);
const serialized = storage.serialize({
  gridSize: 2,
  pixels,
  metadata: {sourceMode: 'server', paletteId: 'natural-64-v1'}
});
assert.equal(serialized.metadata.sourceMode, 'server');
assert.equal(serialized.metadata.paletteId, 'natural-64-v1');
assert.match(serialized.savedAt, /^\d{4}-\d{2}-\d{2}T/);
"""
    run_node(script, JAVASCRIPT_ROOT / "storage.js")


def test_conversion_response_validation_and_error_mapping() -> None:
    script = r"""
const assert = require('node:assert/strict');
const conversion = require(process.argv[1]);
const valid = conversion.validateHexPixels({
  width: 2,
  height: 2,
  hexPixels: [['#abcdef', null], ['#000000', '#FFFFFF']]
}, 2);
assert.deepEqual(valid, [['#ABCDEF', '#FFFFFF'], ['#000000', '#FFFFFF']]);
assert.throws(() => conversion.validateHexPixels({
  width: 3,
  height: 3,
  hexPixels: []
}, 2), /尺寸/);
assert.throws(() => conversion.validateHexPixels({
  width: 1,
  height: 1,
  hexPixels: [['invalid']]
}, 1), /无效颜色/);
assert.match(conversion.errorMessage(413, null), /过大/);
assert.equal(
  conversion.errorMessage(422, {error: {message: 'server detail'}}),
  'server detail'
);
assert.match(conversion.describeSettings({
  width: 24,
  height: 24,
  paletteId: 'natural-64-v1',
  dither: 'none'
}), /24×24.*natural-64-v1.*无抖动.*direct/);
"""
    run_node(script, JAVASCRIPT_ROOT / "conversion-api.js")


def test_all_javascript_files_have_valid_syntax() -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not installed")

    for path in sorted(JAVASCRIPT_ROOT.glob("*.js")):
        result = subprocess.run(
            [node, "--check", str(path)],
            capture_output=True,
            check=False,
        )
        assert result.returncode == 0, (
            f"{path.name}: " + result.stderr.decode("utf-8", errors="replace")
        )
