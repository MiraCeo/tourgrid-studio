from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = PROJECT_ROOT / "frontend"
INDEX_HTML = FRONTEND_ROOT / "index.html"
JAVASCRIPT_ROOT = FRONTEND_ROOT / "js"
FAVICON_FILE = FRONTEND_ROOT / "favicon.ico"


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
    asset_version = "20260729-06"

    assert (
        f'<link rel="stylesheet" '
        f'href="/static/css/editor.css?v={asset_version}">'
    ) in html
    expected_scripts = [
        "storage.js",
        "reference-storage.js",
        "work-codec.js",
        "natural-64-v1.js",
        "state.js",
        "editor.js",
        "export.js",
        "import.js",
        "works.js",
        "app.js",
    ]
    positions = [
        html.index(
            f'<script src="/static/js/{name}?v={asset_version}"></script>'
        )
        for name in expected_scripts
    ]
    assert positions == sorted(positions)
    assert not (PROJECT_ROOT / "像素画编辑器.html").exists()


def test_editor_uses_external_event_listeners_instead_of_inline_handlers() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")

    for attribute in ("onclick=", "onchange=", "oninput=", "onkeydown="):
        assert attribute not in html
    assert "function bindStaticControls()" in app
    assert "bindStaticControls();" in app


def test_frontend_and_admin_reference_the_project_favicon() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    admin_html = (FRONTEND_ROOT / "admin" / "index.html").read_text(
        encoding="utf-8"
    )
    dockerfile = (
        PROJECT_ROOT / "docker" / "frontend.Dockerfile"
    ).read_text(encoding="utf-8")

    assert FAVICON_FILE.read_bytes().startswith(b"\x00\x00\x01\x00")
    assert '<link rel="icon" href="/favicon.ico"' in html
    assert '<link rel="icon" href="/favicon.ico"' in admin_html
    assert "COPY frontend/favicon.ico /srv/favicon.ico" in dockerfile


def test_local_fixed_palette_is_the_only_frontend_import_path() -> None:
    source = read_frontend()
    image_import = (JAVASCRIPT_ROOT / "import.js").read_text(encoding="utf-8")

    assert 'id="conversionMode"' not in source
    assert '<option value="server">' not in source
    assert 'id="conversionCancelBtn"' not in source
    assert '<option value="none" selected>' in source
    assert "var palette = EXHIBITION_DATA.map" in source
    assert "palette.length !== 64" in source
    assert "browser-fixed-palette-v1" in source
    assert "paletteId: DEFAULT_PALETTE_ID" in source
    assert "paletteVersion: DEFAULT_PALETTE_VERSION" in source
    assert "confirmCropLocal()" in image_import
    assert "confirmCropServer" not in image_import
    assert "new FormData()" not in image_import
    assert "new AbortController()" not in image_import
    assert "/api/v1/convert" not in image_import
    assert "TourgridConversion" not in image_import
    assert not (JAVASCRIPT_ROOT / "conversion-api.js").exists()
    assert "K-means" not in image_import
    assert '<span class="crop-size-value">24×24</span>' in source
    assert "const GRID_SIZE = 24" in source


def test_first_run_canvas_is_blank_white_instead_of_a_demo_pattern() -> None:
    editor = (JAVASCRIPT_ROOT / "editor.js").read_text(encoding="utf-8")

    assert "Array.from({ length: GRID_SIZE }, () => '#FFFFFF')" in editor
    assert "loadDemoPattern" not in editor
    assert "首次使用时保留全白画布" in editor


def test_local_converter_keeps_optional_dithering() -> None:
    source = read_frontend()

    assert "confirmCropLocal()" in source
    assert "ditherMode === 'floyd'" in source
    assert "let viewMode" not in source
    assert "id=\"viewMode\"" not in source
    assert "canvasPixelData" not in source


def test_right_palette_matches_fixed_exhibition_editor_contract() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    state = (JAVASCRIPT_ROOT / "state.js").read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")

    assert 'class="editorial-area-label">Editorial Area</div>' in html
    assert html.count('class="tool-icon-btn"') == 5
    assert 'title="撤销（Ctrl/Cmd + Z）"' in html
    assert 'title="重做（Ctrl/Cmd + Y 或 Ctrl/Cmd + Shift + Z）"' in html
    assert 'id="eyedropperBtn"' in html
    assert 'id="moveCanvasBtn"' in html
    assert 'aria-label="吸管取色"' in html
    assert 'aria-pressed="false"' in html
    assert 'id="brushTool"' not in html
    assert 'id="eraserTool"' not in html
    assert 'id="inspectTool"' not in html
    assert 'id="colorPickPopup"' not in html
    assert 'id="palettePicker"' not in html
    assert 'id="colorDisplay"' not in html
    assert "<span>颜料</span>" in html
    assert "<span>复刻</span>" in html
    assert "<span>统计</span>" not in html
    assert 'id="paletteTab"' in html
    assert 'id="statisticsTab"' in html
    assert 'id="statisticsGrid"' in html
    assert 'id="paletteColorScroll" tabindex="0"' in html
    assert 'id="statisticsColorScroll" tabindex="0"' in html
    assert 'id="paletteConversionResultSummary"' in html
    assert 'id="statisticsConversionResultSummary"' in html
    assert 'id="conversionResultSummary"' not in html
    assert html.count('class="conversion-result-summary"') == 2
    assert 'id="statisticsSort"' in html
    assert 'id="replicationCompleteControl"' in html
    assert 'id="replicationCompleteCheckbox"' in html
    assert 'id="replicationPreviewControl"' in html
    assert 'id="replicationTargetViewBtn"' in html
    assert 'id="replicationCompletedViewBtn"' in html
    assert 'id="replicationResetBtn"' in html
    assert "目标图案" in html
    assert "已拼图案" in html
    assert '<option value="count-desc" selected>' in html
    assert '<option value="count-asc">' in html
    assert '<option value="palette-order">' in html
    assert "临时色板 · 64色" in html
    assert html.index('id="statisticsGrid"') < html.index('id="colorUsageSummary"')

    assert "const MARD_DATA" not in state
    assert "{ id: 'mard'" not in state
    assert "togglePalettePicker" not in app
    assert "selectPalette" not in app
    assert "PALETTE_SLOTS" not in app
    assert "cyclePalette" not in app
    assert "palette.forEach(function(color)" in app
    assert "getPaletteUsageEntries" in app
    assert "sortStatisticsEntries" in app
    assert "setStatisticsSortMode" in app
    assert "statisticsSortMode === 'palette-order'" in app
    assert "entries = entries.filter" not in app
    assert "countDifference || a.paletteIndex - b.paletteIndex" in app
    assert "setPalettePanelMode" in app
    assert "selectStatisticsColor" in app
    assert "function setReplicationColorCompleted(completed)" in app
    assert "function setReplicationPreviewMode(mode)" in app
    assert "function clearCurrentReplicationProgress()" in app
    assert "function saveReplicationProgress(previousFingerprint)" in app
    assert "function restoreReplicationProgress()" in app
    assert "function invalidateReplicationProgress(notify)" in app
    assert "isReplicationCellCompleted(x, y)" in app
    assert "if (selected && !completed)" in app
    assert "replicationPreviewMode === 'completed'" in app
    assert "completedPreview" in app
    assert "rgb(232, 236, 239)" in app
    assert "rgba(142, 149, 154, 0.6)" in app
    assert "画布内容已改变，当前作品的复刻进度已重置" in app
    assert "function findClosestPaletteColor(sourceHex)" in app
    assert "function toggleEyedropper()" in app
    assert "function toggleMoveCanvas()" in app
    assert "function setMoveCanvasActive(active)" in app
    assert "if (active && moveCanvasActive) setMoveCanvasActive(false)" in app
    assert "if (active && eyedropperActive) setEyedropperActive(false)" in app
    assert "function sampleCanvasColor(gx, gy)" in app
    assert "focusPanelColor('.color-swatch', 'paletteColorScroll', matchedColor)" in app
    assert "focusPanelColor('.statistics-color', 'statisticsColorScroll', matchedColor)" in app
    assert "statisticsHighlightColor = matchedColor" in app
    assert "currentColor = matchedColor" in app
    assert "setEyedropperActive(false)" in app
    assert "statisticsHighlightColor = null" in app
    assert "paletteColorBeforeReplication = currentColor" in app
    assert "replicationSelectionChanged" in app
    assert "grid.style.paddingTop" not in app
    assert "grid.style.paddingBottom" not in app
    assert "scroller.scrollHeight - scroller.clientHeight" in app
    assert "Math.min(centeredScrollTop, maximumScrollTop)" in app
    assert "targetRect.top + targetRect.height / 2" in app
    assert "scrollerRect.top + scrollerRect.height / 2" in app
    assert "swatch-code" not in css
    assert ".tool-icon-btn.active {" in css
    assert ".eyedropper-icon," in css
    assert ".canvas-guides-icon {" in css
    assert ".move-canvas-icon {" in css
    assert ".canvas-container.move-canvas-active #pixelCanvas" in css
    assert ".color-pick-popup" not in css
    assert "box-sizing: border-box" in css
    assert ".right-panel {" in css
    assert "overflow: hidden" in css
    assert ".palette-color-scroll," in css
    assert ".statistics-color-scroll {" in css
    assert "overflow-y: auto" in css
    assert "border-color: #72F5F2" in css
    assert ".replication-complete-control {" in css
    assert ".replication-preview-control {" in css
    assert ".replication-reset-btn {" in css
    assert ".statistics-color.completed::before" in css
    editor = (JAVASCRIPT_ROOT / "editor.js").read_text(encoding="utf-8")
    overlay = (JAVASCRIPT_ROOT / "import.js").read_text(encoding="utf-8")
    assert "const color = currentColor;" in editor
    assert "if (eyedropperActive)" in editor
    assert "sampleCanvasColor(samplePos.x, samplePos.y)" in editor
    assert "if (!currentColor)" in editor
    assert "请先从颜料中选择一种颜色" in editor
    assert "let currentColor = '#222222'" in state
    assert "mainCtx.fillText" not in editor
    assert "markReplicationCellCompleted(replicationPos.x, replicationPos.y)" in editor
    assert "复刻模式下画布为只读" in editor
    assert 'id="statisticsOverlayCanvas"' in html
    assert "statisticsOverlayCanvas.style.display = 'none'" in app
    assert "renderStatisticsHighlightOverlay()" in editor
    assert "renderStatisticsHighlightOverlay()" not in overlay
    assert "'rgba(16, 18, 22, 0.72)'" in app
    assert "document.querySelectorAll('.conversion-result-summary')" in state


def test_embedded_local_palette_matches_versioned_json() -> None:
    script = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const embedded = require(process.argv[1]);
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(embedded.id, source.id);
assert.equal(embedded.version, source.version);
assert.equal(embedded.colors.length, 64);
assert.deepEqual(
  embedded.colors.map(({code, hex, name}) => ({code, hex, name})),
  source.colors.map(({id, hex, name}) => ({code: id, hex, name}))
);
"""
    run_node(
        script,
        JAVASCRIPT_ROOT / "natural-64-v1.js",
        PROJECT_ROOT / "palettes" / "natural-64-v1.json",
    )


def test_import_ui_supports_local_retry_status_and_touch_crop() -> None:
    source = read_frontend()

    assert 'id="conversionRetryBtn"' in source
    assert "showRetry ? 'inline-flex' : 'none'" in source
    assert "正在准备本地转换" in source
    assert "正在上传裁切图片" not in source
    assert "服务器正在转换" not in source
    assert "onCropTouchStart" in source
    assert "onCropTouchMove" in source
    assert "touch-action: none" in source


def test_phone_and_tablet_responsive_contract() -> None:
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")

    assert "@media (max-width: 960px)" in css
    assert "width: min(320px, 42dvh)" in css
    assert "height: min(320px, 42dvh)" in css
    assert "function checkOrientation()" in app
    assert "window.addEventListener('resize', checkOrientation)" in app
    assert "window.addEventListener('orientationchange'" in app


def test_primary_interface_text_keeps_readable_hierarchy() -> None:
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")

    assert ".warn-text {\n  font-size: 13px;" in css
    assert ".work-identity-title {" in css
    assert "font-size: 15px;" in css
    assert ".nav-title {" in css
    assert ".left-control-heading {" in css
    assert ".reference-switch {" in css
    assert ".opacity-control {" in css
    assert css.count("font-size: 12px;") >= 6


def test_exports_include_raw_and_nearest_neighbor_preview() -> None:
    source = read_frontend()

    assert "exportRawPixelImage()" in source
    assert "exportPixelPreview()" in source
    assert "buildPixelExportCanvas(1)" in source
    assert "var scale = 16" in source
    assert "buildPixelExportCanvas(scale)" in source
    assert "outputCtx.imageSmoothingEnabled = false" in source
    assert source.count('class="export-item-icon"') == 5
    assert source.count('class="export-item-icon" aria-hidden="true">') == 5
    assert "🖼" not in source
    assert "🔍" not in source
    assert "📿" not in source
    assert "📱" not in source
    assert source.count('class="export-item-label"') == 5
    assert "grid-template-columns: 24px minmax(0, 1fr)" in source
    assert "viewportPadding = 8" in source
    assert "rect.top - dropdownHeight - 6" in source
    assert "calc(100vw - 16px)" in source
    assert "calc(100dvh - 16px)" in source


def test_editor_icons_and_visible_operation_messages_are_consistent() -> None:
    source = read_frontend()

    assert 'class="history-icon"' in source
    assert source.count('class="palette-tab-icon"') == 2
    assert 'class="external-link-icon"' in source
    assert "Nothing to undo" not in source
    assert "Nothing to redo" not in source
    assert "Clear canvas?" not in source
    assert "Canvas cleared" not in source
    assert "💾" not in source
    assert "没有可以撤销的操作" in source
    assert "没有可以重做的操作" in source
    assert "画布已清空，可按 Ctrl+Z 撤销" in source


def test_blueprint_is_fixed_to_24_square_without_palette_remapping() -> None:
    export = (JAVASCRIPT_ROOT / "export.js").read_text(encoding="utf-8")

    assert "function getBlueprintData()" in export
    assert "paletteByHex[pixelHex]" in export
    assert "画布包含色库外颜色" in export
    assert "GRID_SIZE * GRID_SIZE" in export
    assert "_blueprint.png" in export
    assert "var BOARD" not in export
    assert "boardsX" not in export
    assert "boardsY" not in export
    assert "totalBoards" not in export
    assert "boardBeadMap" not in export
    assert "colorDistRGB" not in export
    assert "bestD" not in export
    assert "分板" not in export


def test_shared_work_codec_round_trips_432_byte_payload() -> None:
    script = r"""
const assert = require('node:assert/strict');
const codec = require(process.argv[1]);
const palette = require(process.argv[2]).colors;
const pixels = Array.from({length: 24}, (_, y) =>
  Array.from({length: 24}, (_, x) => palette[(y * 24 + x) % 64].hex)
);
const encoded = codec.packPixels(pixels, palette);
assert.equal(encoded.length, 576);
assert.equal(Buffer.from(encoded, 'base64').length, 432);
assert.deepEqual(codec.unpackPixels(encoded, palette), pixels);
assert.throws(
  () => codec.packPixels(
    pixels.map((row, index) =>
      index === 0 ? ['#123456', ...row.slice(1)] : row
    ),
    palette
  ),
  /色库外颜色/
);
"""
    run_node(
        script,
        JAVASCRIPT_ROOT / "work-codec.js",
        JAVASCRIPT_ROOT / "natural-64-v1.js",
    )


def test_frontend_can_publish_and_load_immutable_shared_works() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    works = (JAVASCRIPT_ROOT / "works.js").read_text(encoding="utf-8")
    storage = (JAVASCRIPT_ROOT / "storage.js").read_text(encoding="utf-8")

    assert 'id="workShareModal" hidden' in html
    assert "保存并分享作品" in html
    assert "读取分享码" in html
    assert 'id="publishedWorkCode"' in html
    assert 'id="workTitleInput"' in html
    assert 'id="workAuthorInput"' in html
    assert 'value="很糊的画"' in html
    assert 'value="博士"' in html
    assert "作品标题（默认为" not in html
    assert "作者名称（默认为" not in html
    assert html.count('maxlength="10"') >= 2
    assert 'id="publishedWorkLink"' in html
    assert 'id="workCodeInput"' in html
    assert "TourgridWorkCodec.packPixels" in works
    assert "TourgridWorkCodec.unpackPixels" in works
    assert "POST" in works
    assert "'/api/v1/works'" in works
    assert "'/api/v1/works/'" in works
    assert "copyPublishedWorkCode()" in works
    assert "copyPublishedWorkLink()" in works
    assert "buildSharedWorkLink(code)" in works
    assert "publishConfirmationCanvas" in html
    assert "confirmPublishCurrentWork()" in works
    assert "readReplaceConfirmation" in html
    assert "checkpointAndLoadSharedWork()" in works
    assert "SHARE_CODE_PATTERN" in works
    assert "authorName: pendingPublish.authorName" in works
    assert "title: pendingPublish.title" in works
    assert "已读取《" in works
    assert "作者：" in works
    assert "body.title || '很糊的画'" in works
    assert "body.authorName || '博士'" in works
    assert "pushUndo()" in works
    assert "clearReferenceImage(false)" in works
    assert "sourceMode: 'shared'" in works
    assert "loadSharedWorkFromQuery()" in works
    assert "'shared'" in storage


def test_storage_migrates_old_documents_and_rejects_invalid_pixels() -> None:
    script = r"""
const assert = require('node:assert/strict');
const storage = require(process.argv[1]);
const pixels = Array.from(
  {length: 24},
  () => Array.from({length: 24}, (_, index) => index % 2 ? '#000000' : '#ffffff')
);
const migrated = storage.migrate({
  gridSize: 24,
  pixels,
  paletteId: 'mard',
  savedAt: '2026-01-01T00:00:00.000Z'
});
assert.equal(migrated.schemaVersion, 4);
assert.equal(migrated.metadata.editorPaletteId, 'mard');
assert.equal(migrated.metadata.sourceMode, 'canvas');
assert.equal(migrated.pixels[0][0], '#FFFFFF');
assert.equal(migrated.reference.assetId, null);
assert.equal(migrated.reference.opacity, 0.4);
assert.equal(storage.migrate({gridSize: 2, pixels: [['#FFFFFF', '#000000'], ['#FFFFFF', '#000000']]}), null);
const serialized = storage.serialize({
  gridSize: 24,
  pixels,
  metadata: {sourceMode: 'server', paletteId: 'natural-64-v1'},
  reference: {
    assetId: 'active-reference',
    mimeType: 'image/webp',
    width: 256,
    height: 256,
    visible: true,
    opacity: 0.75
  }
});
assert.equal(serialized.metadata.sourceMode, 'server');
assert.equal(serialized.metadata.paletteId, 'natural-64-v1');
assert.equal(serialized.reference.assetId, 'active-reference');
assert.equal(serialized.reference.visible, true);
assert.equal(serialized.reference.opacity, 0.75);
assert.match(serialized.savedAt, /^\d{4}-\d{2}-\d{2}T/);
"""
    run_node(script, JAVASCRIPT_ROOT / "storage.js")


def test_reference_image_is_encoded_as_webp_and_persisted_in_indexeddb() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    state = (JAVASCRIPT_ROOT / "state.js").read_text(encoding="utf-8")
    editor = (JAVASCRIPT_ROOT / "editor.js").read_text(encoding="utf-8")
    image_import = (JAVASCRIPT_ROOT / "import.js").read_text(encoding="utf-8")
    reference_storage = (
        JAVASCRIPT_ROOT / "reference-storage.js"
    ).read_text(encoding="utf-8")

    assert "const REFERENCE_IMAGE_SIZE = 256" in image_import
    assert "const REFERENCE_WEBP_QUALITY = 0.88" in image_import
    assert "canvas.toBlob(function(blob)" in image_import
    assert "'image/webp', REFERENCE_WEBP_QUALITY" in image_import
    assert "TourgridReferenceStorage.save(blob" in image_import
    assert "TourgridReferenceStorage.load(referenceState.assetId)" in image_import
    assert "TourgridReferenceStorage.remove(assetId)" in image_import
    assert "restorePersistedReference()" in editor
    assert "reference: Object.assign({}, referenceState" in state
    assert "root.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)" in reference_storage
    assert "database.createObjectStore(STORE_NAME, { keyPath: 'id' })" in reference_storage
    assert "store.put(record)" in reference_storage
    assert "on('overlayOpacity', 'change'" in (
        JAVASCRIPT_ROOT / "app.js"
    ).read_text(encoding="utf-8")


def test_document_history_restores_reference_assets_and_keeps_100_steps() -> None:
    state = (JAVASCRIPT_ROOT / "state.js").read_text(encoding="utf-8")
    editor = (JAVASCRIPT_ROOT / "editor.js").read_text(encoding="utf-8")
    image_import = (JAVASCRIPT_ROOT / "import.js").read_text(encoding="utf-8")
    reference_storage = (
        JAVASCRIPT_ROOT / "reference-storage.js"
    ).read_text(encoding="utf-8")

    assert "const MAX_UNDO = 100" in state
    assert "historyOperationInProgress" in state
    assert "reference: referenceSnapshotForHistory()" in editor
    assert "await restoreReferenceFromHistory(snapshot.reference)" in editor
    assert "pushUndo(beforeImport)" in image_import
    assert "clearReferenceImage(false)" in editor
    assert "saveToStorage(true)" in editor
    assert "root.crypto.randomUUID" in reference_storage
    assert "store.getAllKeys()" in reference_storage
    assert "pruneReferenceAssets()" in editor


def test_manual_checkpoint_is_distinct_from_autosave_and_precedes_import() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    state = (JAVASCRIPT_ROOT / "state.js").read_text(encoding="utf-8")
    editor = (JAVASCRIPT_ROOT / "editor.js").read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")

    assert "pixel_editor_manual_checkpoint" in state
    assert "function loadManualCheckpoint()" in state
    assert "async function restoreManualCheckpoint()" in editor
    assert "var checkpoint = loadManualCheckpoint()" in editor
    assert "!hasShortcutModifier(e) && key === 's'" in app
    assert "e.ctrlKey && e.key === 's'" not in app
    assert "function isShortcutInput(target)" in app
    assert "input, textarea, select, button, a[href]" in app
    assert "e.metaKey" in app
    assert html.index('id="manualCheckpointRestoreBtn"') < html.index(
        'id="manualCheckpointSaveBtn"'
    )
    assert html.index('id="manualCheckpointSaveBtn"') < html.index(
        'id="topImportButton"'
    )
    assert 'class="btn-import"' in html
    assert '<span>导入图片</span>' in html
    assert ".btn-import {" in css
    assert "#D8832F" in css
    assert ".btn-save-icon" not in css
    assert ".btn-save-label" not in css


def test_top_bar_uses_dynamic_shared_work_identity_and_unified_svg_icons() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    state = (JAVASCRIPT_ROOT / "state.js").read_text(encoding="utf-8")
    editor = (JAVASCRIPT_ROOT / "editor.js").read_text(encoding="utf-8")
    works = (JAVASCRIPT_ROOT / "works.js").read_text(encoding="utf-8")

    top_bar = html.split('<div class="top-bar">', 1)[1].split(
        '<div class="editor-body">',
        1,
    )[0]
    assert 'id="topWorkTitle"' in top_bar
    assert 'id="topWorkMeta"' in top_bar
    assert "Tourgrid Studio｜24×24 像素画编辑器" in top_bar
    assert "Exhibition Gallery.indd" not in top_bar
    assert "🗑" not in top_bar
    assert "↻" not in top_bar
    assert "💾" not in top_bar
    assert "📁" not in top_bar
    assert top_bar.count("<svg") >= 8
    assert 'class="top-action-icon"' in top_bar
    assert 'class="import-icon"' in top_bar
    assert 'class="check-icon"' in top_bar
    assert ".work-identity-title {" in css
    assert ".work-identity-meta {" in css
    assert "function updateTopWorkIdentity()" in state
    assert "function markSharedWorkAsEdited()" in state
    assert "markSharedWorkAsEdited();" in editor
    assert "sharedTitle: body.title || '很糊的画'" in works
    assert "sharedAuthorName: body.authorName || '博士'" in works
    assert "sharedViewCount: body.viewCount" in works


def test_navigator_uses_compass_rose_svg_instead_of_emoji() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    navigator = html.split('<div class="nav-title">', 1)[1].split(
        "</div>",
        1,
    )[0]

    assert '<svg class="nav-icon"' in navigator
    assert "🧭" not in navigator
    assert 'class="nav-compass-cardinal"' in navigator
    assert 'class="nav-compass-diagonal"' in navigator
    assert 'class="nav-compass-center"' in navigator
    assert ".nav-compass-cardinal {" in css
    assert ".nav-compass-diagonal {" in css
    assert ".nav-compass-center {" in css


def test_removed_decorative_image_has_no_stale_markup_or_styles() -> None:
    source = read_frontend()

    assert "sucai/wenzi.png" not in source
    assert 'class="top-image-area"' not in source
    assert ".top-image-area" not in source


def test_center_workspace_has_fixed_scrollbar_free_canvas_viewport() -> None:
    html = (FRONTEND_ROOT / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    state = (JAVASCRIPT_ROOT / "state.js").read_text(encoding="utf-8")
    editor = (JAVASCRIPT_ROOT / "editor.js").read_text(encoding="utf-8")

    assert 'id="gridInfo"' not in html
    assert "gridInfoEl" not in state
    assert "gridInfoEl" not in editor
    assert ".center-panel {" in css
    assert "overflow: hidden" in css
    assert ".canvas-container::-webkit-scrollbar" in css
    assert "scrollbar-width: none" in css
    assert "overscroll-behavior: contain" in css
    assert "canvasContainer.addEventListener('wheel', onWheel" in editor
    assert "canvasContainer.scrollLeft" in editor
    assert "canvasContainer.scrollTop" in editor


def test_canvas_center_axes_render_above_pixels_in_black() -> None:
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    editor = (JAVASCRIPT_ROOT / "editor.js").read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")
    image_import = (JAVASCRIPT_ROOT / "import.js").read_text(encoding="utf-8")

    assert ".canvas-container::before" not in css
    assert ".canvas-container::after" not in css
    assert "function drawCanvasCenterAxes(ctx, width, height)" in editor
    assert "ctx.strokeStyle = 'rgba(0, 0, 0, 0.72)'" in editor
    assert "ctx.moveTo(width / 2, 0)" in editor
    assert "ctx.lineTo(width / 2, height)" in editor
    assert "ctx.moveTo(0, height / 2)" in editor
    assert "ctx.lineTo(width, height / 2)" in editor
    assert "drawCanvasCenterAxes(mainCtx, w, h)" in editor
    assert (
        "drawCanvasCenterAxes(\n"
        "    statisticsOverlayCtx,\n"
        "    canvasSize,\n"
        "    canvasSize\n"
        "  )"
    ) in app
    assert "drawCanvasCenterAxes(overlayCtx, w, w)" in image_import


def test_canvas_guides_toggle_controls_grid_axes_and_statistics_highlight() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    editor = (JAVASCRIPT_ROOT / "editor.js").read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")
    state = (JAVASCRIPT_ROOT / "state.js").read_text(encoding="utf-8")

    assert html.index('id="canvasGuidesBtn"') < html.index('id="undoBtn"')
    assert 'aria-label="隐藏画布辅助线"' in html
    assert "function toggleCanvasGuides()" in editor
    assert "if (canvasGuidesVisible)" in editor
    assert "if (!canvasGuidesVisible) return;" in editor
    assert "Math.round(y * mainCanvas.height / GRID_SIZE)" in editor
    assert "Math.round(x * mainCanvas.width / GRID_SIZE)" in editor
    assert "right - left" in editor
    assert "bottom - top" in editor
    assert "!canvasGuidesVisible" in app
    assert "tourgrid_canvas_guides_visible" in state


def test_all_canvas_zoom_controls_share_20_to_400_percent_range() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")
    editor = (JAVASCRIPT_ROOT / "editor.js").read_text(encoding="utf-8")

    assert 'min="20" max="400" value="100"' in html
    assert "function getMinZoom() {\n  return 20;" in app
    assert "Math.min(400, targetZoom)" in app
    assert "Math.min(400, zoom + delta)" in editor
    assert "Math.min(400, newZoom)" in editor


def test_canvas_viewport_background_is_transparent() -> None:
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    canvas_rule = css.split(".canvas-container {", 1)[1].split("}", 1)[0]

    assert "background: transparent" in canvas_rule
    assert "background: #fff" not in canvas_rule
    assert "border: none" in canvas_rule
    assert "border: 1px solid #D0D4D8" not in canvas_rule


def test_desktop_editor_uses_large_viewport_workspace_layout() -> None:
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    state = (JAVASCRIPT_ROOT / "state.js").read_text(encoding="utf-8")

    assert "inset: 12px" in css
    assert "min-height: 58px" in css
    assert "max-height: none" in css
    assert "clamp(190px, 17vw, 300px)" in css
    assert "clamp(280px, 24vw, 420px)" in css
    assert "width: min(100%, calc(100dvh - 116px))" in css
    assert "const BASE_CELL_SIZE = 50 / 3" in state
    assert "width: min(96vw, 1300px)" not in css
    assert "max-height: calc(100vh - 300px)" not in css


def test_canvas_max_zoom_is_1200_square_and_controls_center_it() -> None:
    state = (JAVASCRIPT_ROOT / "state.js").read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")

    assert "const BASE_CELL_SIZE = 50 / 3" in state
    assert "(canvasContainer.scrollWidth - canvasContainer.clientWidth) / 2" in app
    assert "(canvasContainer.scrollHeight - canvasContainer.clientHeight) / 2" in app


def test_left_navigator_groups_reference_and_zoom_controls() -> None:
    html = (FRONTEND_ROOT / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    editor = (JAVASCRIPT_ROOT / "editor.js").read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")
    image_import = (JAVASCRIPT_ROOT / "import.js").read_text(encoding="utf-8")

    assert 'id="navViewportIndicator"' in html
    assert 'class="left-controls"' in html
    assert 'id="navSourceOriginal"' not in html
    assert 'id="navSourcePixels"' not in html
    assert "缩略图显示" not in html
    assert 'role="switch" aria-checked="false"' in html
    assert 'id="overlayOpacity" min="0" max="100" value="40"' in html
    assert "on('zoomResetBtn', 'click', fitCanvasToViewport)" in app
    assert 'class="zoom-reset-btn"' in html
    assert 'aria-label="适应画布" title="适应画布（0）"' in html
    assert 'class="zoom-reset-icon"' in html
    assert 'class="zoom-heading-icon"' in html
    assert '<span class="left-control-heading">缩放</span>' not in html
    assert 'id="zoomValue"' not in html
    assert 'class="zoom-step-btn"' not in html
    assert 'class="zoom-fit-btn"' not in html
    assert 'id="zoomBtnsMobile"' not in html
    assert 'class="zoom-mb-btn"' not in html
    assert 'id="navToggleBtn"' not in html
    assert ".nav-viewport-indicator {" in css
    assert ".nav-source-segment {" not in css
    assert ".reference-switch.active" in css
    assert html.index('id="overlayControls"') < html.index('id="zoomSliderWrap"')
    assert "writing-mode: vertical-lr" in css
    assert "@media (max-width: 900px), (max-height: 700px)" in css
    assert "writing-mode: horizontal-tb" in css
    assert ".zoom-slider::-webkit-slider-runnable-track" in css
    assert "width: 10px" in css
    assert ".zoom-slider::-webkit-slider-thumb" in css
    assert "width: 28px" in css
    assert ".zoom-reset-btn {" in css
    assert "--zoom-progress:" in css
    assert "#72F5F2 var(--zoom-progress)" in css
    assert ".zoom-reset-icon {" in css
    assert ".zoom-heading-icon {" in css
    assert "background: #2C2C30" in css

    assert "onNavigatorPointerDown" in editor
    assert "canvasContainer.addEventListener('scroll', updateNavigatorViewport)" in editor
    assert "function updateNavigatorViewport()" in app
    assert "function positionCanvasFromNavigator(e)" in app
    assert "function fitCanvasToViewport()" in app
    assert "function updateZoomControlState()" in app
    assert "slider.style.setProperty('--zoom-progress'" in app
    assert "function setNavigatorSource(mode)" not in image_import
    assert "navShowOriginal" not in image_import
    assert "navShowOriginal" not in editor
    assert "navCtx.drawImage(importedPreviewImage" not in editor
    assert "function syncOverlayControls()" in image_import
    assert "opacityInput.disabled = !overlayVisible" in image_import
    assert "opacityControl.hidden = !overlayVisible" in image_import


def test_top_bar_and_left_controls_have_stable_narrow_layout() -> None:
    html = (FRONTEND_ROOT / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")

    assert 'class="top-leading-actions"' in html
    assert "@media (max-width: 1180px)" in css
    assert "@media (max-width: 960px)" in css
    assert "@media (max-width: 680px)" in css
    assert "flex-wrap: nowrap" in css
    assert ".top-bar .work-identity {\n    display: none;" in css
    assert ".top-bar .btn-fullscreen {\n    display: flex;" in css
    assert ".left-controls {" in css
    assert "overflow-x: hidden" in css
    assert "overscroll-behavior: contain" in css
    assert ".opacity-control[hidden]" in css


def test_mobile_fullscreen_control_uses_browser_fullscreen_api() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")

    assert 'id="mobileFullscreenBtn"' in html
    assert "on('mobileFullscreenBtn', 'click', toggleFullscreen)" in app
    assert 'class="fullscreen-enter-icon"' in html
    assert 'class="fullscreen-exit-icon"' in html
    assert ".btn-fullscreen {" in css
    assert ".btn-fullscreen[hidden] {" in css
    assert "function isFullscreenSupported()" in app
    assert "button.hidden = !supported" in app
    assert "function toggleFullscreen()" in app
    assert "root.requestFullscreen || root.webkitRequestFullscreen" in app
    assert "{ navigationUI: 'hide' }" in app
    assert "document.exitFullscreen || document.webkitExitFullscreen" in app
    assert "document.addEventListener('fullscreenchange'" in app
    assert "function syncFullscreenControl()" in app


def test_mobile_workspace_mode_preserves_original_layout_and_adds_focus_controls() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")

    assert 'id="mobileWorkspaceModeBtn"' in html
    assert 'id="mobileToolbarCollapseBtn"' in html
    assert 'id="mobileToolbarHandle"' in html
    assert 'class="mobile-toolbar-rail"' in html
    assert 'id="mobileLeftPanelBtn"' in html
    assert 'id="mobileRightPanelBtn"' in html
    assert 'id="workspaceDrawerBackdrop"' not in html
    assert 'id="leftPanel"' in html
    assert 'id="rightPanel"' in html
    assert ".btn-workspace-mode {" in css
    assert "body.mobile-focus-mode .left-panel" in css
    assert "body.mobile-focus-mode .right-panel" in css
    assert "body.mobile-focus-mode .center-panel" in css
    assert "body.mobile-focus-mode.mobile-toolbar-collapsed .top-bar" in css
    assert "function setMobileWorkspaceMode(active, announce)" in app
    assert "function setMobileWorkspaceDrawer(side)" in app
    assert "on('workspaceDrawerBackdrop', 'click'" not in app
    assert "function setMobileToolbarCollapsed(collapsed)" in app
    assert "on('mobileToolbarCollapseBtn', 'click', toggleMobileToolbar)" in app
    assert "function onMobileWorkspacePointerDown(event)" in app
    assert "event.target.closest('#pixelCanvas')" in app
    assert "MOBILE_WORKSPACE_SWIPE_THRESHOLD = 40" in app
    assert "sessionStorage.setItem(MOBILE_WORKSPACE_MODE_KEY, 'focus')" in app
    assert "top: env(safe-area-inset-top)" in css
    assert "right: env(safe-area-inset-right)" in css
    assert "bottom: env(safe-area-inset-bottom)" in css
    assert "left: env(safe-area-inset-left)" in css
    assert ".mobile-toolbar-handle::before" in css
    assert ".replication-reset-btn::before" in css


def test_work_share_modal_is_scrollable_inside_short_safe_viewports() -> None:
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    works = (JAVASCRIPT_ROOT / "works.js").read_text(encoding="utf-8")

    assert ".work-share-overlay {" in css
    assert "max(8px, env(safe-area-inset-top))" in css
    assert "max(8px, env(safe-area-inset-bottom))" in css
    assert ".work-share-modal {" in css
    assert "max-height: 100%" in css
    assert "-webkit-overflow-scrolling: touch" in css
    assert "@media (max-height: 480px)" in css
    assert "if (dialog) dialog.scrollTop = 0" in works


def test_author_project_modal_uses_no_unlicensed_avatar_and_safe_github_links() -> None:
    html = (FRONTEND_ROOT / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")
    avatar = FRONTEND_ROOT / "assets" / "images" / "miraceo-avatar.jpg"

    assert not avatar.exists()
    assert not (PROJECT_ROOT / "input1.jpg").exists()
    assert 'class="icon-btn btn-github"' in html
    assert "on('authorInfoBtn', 'click', openAuthorModal)" in app
    assert 'id="authorModal" hidden' in html
    assert "miraceo-avatar" not in html
    assert "author-avatar-frame" not in html
    assert 'href="https://github.com/MiraCeo"' in html
    assert 'href="https://github.com/MiraCeo/tourgrid-studio"' in html
    assert html.count('target="_blank"') >= 2
    assert html.count('rel="noopener noreferrer"') >= 2
    assert 'title="重新导入"' not in html
    assert ".author-overlay {" in css
    assert ".author-avatar-frame {" not in css
    assert ".author-link {" in css
    assert "function openAuthorModal()" in app
    assert "function closeAuthorModal()" in app
    assert "function closeAuthorModalFromBackdrop(e)" in app
    assert "if (e.key === 'Escape')" in app


def test_announcement_is_opened_on_entry_and_includes_project_policies() -> None:
    html = (FRONTEND_ROOT / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")

    assert 'class="icon-btn btn-announcement"' in html
    assert "on('announcementBtn', 'click', openAnnouncementModal)" in app
    assert 'id="announcementModal" hidden' in html
    assert 'aria-labelledby="announcementModalTitle"' in html
    assert '<h2 id="announcementModalTitle">项目公告</h2>' in html
    assert "<h3>项目介绍</h3>" in html
    assert "<h3>使用指南</h3>" in html
    assert "<h3>隐私与作品保存</h3>" in html
    assert "<h3>内容规则与联系</h3>" in html
    assert "项目 GitHub Issues" in html
    assert "申请删除作品" in html
    assert "访问 IP" in html
    assert "更新日志" not in html
    assert html.count('class="announcement-section"') == 5
    assert "<h3>快捷键帮助</h3>" in html
    assert '<kbd>按住 H</kbd>' in html
    assert "输入框、下拉框、文本区域、按钮、链接或可编辑内容聚焦时" in html
    assert ".btn-announcement {" in css
    assert ".announcement-modal {" in css
    assert ".announcement-steps {" in css
    assert "function openAnnouncementModal()" in app
    assert "function openAnnouncementOnEntry()" in app
    assert "function closeAnnouncementModal()" in app
    assert "function closeAnnouncementModalFromBackdrop(e)" in app
    assert "sessionStorage.getItem(ANNOUNCEMENT_SESSION_KEY)" in app
    assert "loadSharedWorkFromQuery();\n  openAnnouncementOnEntry();" in app


def test_all_javascript_files_have_valid_syntax() -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not installed")

    paths = list(JAVASCRIPT_ROOT.glob("*.js"))
    paths.extend((FRONTEND_ROOT / "admin").glob("*.js"))
    for path in sorted(paths):
        result = subprocess.run(
            [node, "--check", str(path)],
            capture_output=True,
            check=False,
        )
        assert result.returncode == 0, (
            f"{path.name}: " + result.stderr.decode("utf-8", errors="replace")
        )
