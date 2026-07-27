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
        "reference-storage.js",
        "natural-64-v1.js",
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
    assert "viewMode" not in source
    assert "canvasPixelData" not in source


def test_right_palette_matches_fixed_exhibition_editor_contract() -> None:
    html = INDEX_HTML.read_text(encoding="utf-8")
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    state = (JAVASCRIPT_ROOT / "state.js").read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")

    assert 'class="editorial-area-label">Editorial Area</div>' in html
    assert html.count('class="tool-icon-btn"') == 3
    assert 'title="撤销"' in html
    assert 'title="重做"' in html
    assert 'id="eyedropperBtn"' in html
    assert 'aria-label="吸管取色"' in html
    assert 'aria-pressed="false"' in html
    assert 'id="brushTool"' not in html
    assert 'id="eraserTool"' not in html
    assert 'id="inspectTool"' not in html
    assert 'id="colorPickPopup"' not in html
    assert 'id="palettePicker"' not in html
    assert 'id="colorDisplay"' not in html
    assert "<span>颜料</span>" in html
    assert "<span>统计</span>" in html
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
    assert '<option value="count-desc" selected>' in html
    assert '<option value="count-asc">' in html
    assert '<option value="palette-order">' in html
    assert "巡展像素 · 64色" in html
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
    assert "entry.count > 0" not in app
    assert "countDifference || a.paletteIndex - b.paletteIndex" in app
    assert "setPalettePanelMode" in app
    assert "selectStatisticsColor" in app
    assert "function findClosestPaletteColor(sourceHex)" in app
    assert "function toggleEyedropper()" in app
    assert "function sampleCanvasColor(gx, gy)" in app
    assert "focusPanelColor('.color-swatch', 'paletteColorScroll', matchedColor)" in app
    assert "focusPanelColor('.statistics-color', 'statisticsColorScroll', matchedColor)" in app
    assert "statisticsHighlightColor = matchedColor" in app
    assert "currentColor = matchedColor" in app
    assert "setEyedropperActive(false)" in app
    assert "statisticsHighlightColor = currentColor" in app
    assert "currentColor = statisticsHighlightColor;" in app
    assert "grid.style.paddingTop" not in app
    assert "grid.style.paddingBottom" not in app
    assert "scroller.scrollHeight - scroller.clientHeight" in app
    assert "Math.min(centeredScrollTop, maximumScrollTop)" in app
    assert "targetRect.top + targetRect.height / 2" in app
    assert "scrollerRect.top + scrollerRect.height / 2" in app
    assert "swatch-code" not in css
    assert ".tool-icon-btn.active {" in css
    assert ".eyedropper-icon {" in css
    assert ".color-pick-popup" not in css
    assert "box-sizing: border-box" in css
    assert ".right-panel {" in css
    assert "overflow: hidden" in css
    assert ".palette-color-scroll," in css
    assert ".statistics-color-scroll {" in css
    assert "overflow-y: auto" in css
    assert "border-color: #72F5F2" in css
    editor = (JAVASCRIPT_ROOT / "editor.js").read_text(encoding="utf-8")
    overlay = (JAVASCRIPT_ROOT / "import.js").read_text(encoding="utf-8")
    assert "const color = currentColor;" in editor
    assert "if (eyedropperActive)" in editor
    assert "sampleCanvasColor(samplePos.x, samplePos.y)" in editor
    assert "if (!currentColor)" in editor
    assert "请先从颜料中选择一种颜色" in editor
    assert "let currentColor = '#222222'" in state
    assert "mainCtx.fillText" not in editor
    assert "if (isStatisticsMode()) return;" in editor
    assert "统计模式下画布为只读" in editor
    assert "renderStatisticsHighlightOverlay()" in overlay
    assert "overlayCtx.fillStyle = 'rgba(16, 18, 22, 0.72)'" in app
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

    assert "@media (max-width: 900px)" in css
    assert "width: min(320px, 42dvh)" in css
    assert "height: min(320px, 42dvh)" in css
    assert "function checkOrientation()" in app
    assert "window.addEventListener('resize', checkOrientation)" in app
    assert "window.addEventListener('orientationchange'" in app


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
    assert 'onchange="saveToStorage(true)"' in html


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
    assert "drawCanvasCenterAxes(overlayCtx, canvasSize, canvasSize)" in app
    assert "drawCanvasCenterAxes(overlayCtx, w, w)" in image_import


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
    assert 'id="navSourceOriginal"' not in html
    assert 'id="navSourcePixels"' not in html
    assert "缩略图显示" not in html
    assert 'role="switch" aria-checked="false"' in html
    assert 'id="overlayOpacity" min="0" max="100" value="40"' in html
    assert "fitCanvasToViewport()" in html
    assert 'class="zoom-reset-btn"' in html
    assert 'aria-label="适应画布" title="适应画布"' in html
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
    assert "writing-mode: vertical-lr" in css
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


def test_author_project_modal_uses_local_avatar_and_safe_github_links() -> None:
    html = (FRONTEND_ROOT / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")
    avatar = FRONTEND_ROOT / "assets" / "images" / "miraceo-avatar.jpg"

    assert avatar.is_file()
    assert avatar.stat().st_size > 0
    assert not (PROJECT_ROOT / "input1.jpg").exists()
    assert 'class="icon-btn btn-github"' in html
    assert 'onclick="openAuthorModal()"' in html
    assert 'id="authorModal" hidden' in html
    assert '/static/assets/images/miraceo-avatar.jpg' in html
    assert 'href="https://github.com/MiraCeo"' in html
    assert 'href="https://github.com/MiraCeo/tourgrid-studio"' in html
    assert html.count('target="_blank"') >= 2
    assert html.count('rel="noopener noreferrer"') >= 2
    assert 'title="重新导入"' not in html
    assert ".author-overlay {" in css
    assert ".author-avatar-frame {" in css
    assert ".author-link {" in css
    assert "function openAuthorModal()" in app
    assert "function closeAuthorModal()" in app
    assert "function closeAuthorModalFromBackdrop(e)" in app
    assert "if (e.key === 'Escape')" in app


def test_announcement_button_and_modal_include_project_intro_and_guide() -> None:
    html = (FRONTEND_ROOT / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND_ROOT / "css" / "editor.css").read_text(encoding="utf-8")
    app = (JAVASCRIPT_ROOT / "app.js").read_text(encoding="utf-8")

    assert 'class="icon-btn btn-announcement"' in html
    assert 'onclick="openAnnouncementModal()"' in html
    assert 'id="announcementModal" hidden' in html
    assert 'aria-labelledby="announcementModalTitle"' in html
    assert '<h2 id="announcementModalTitle">项目公告</h2>' in html
    assert "<h3>项目介绍</h3>" in html
    assert "<h3>使用指南</h3>" in html
    assert "更新日志" not in html
    assert html.count('class="announcement-section"') == 2
    assert ".btn-announcement {" in css
    assert ".announcement-modal {" in css
    assert ".announcement-steps {" in css
    assert "function openAnnouncementModal()" in app
    assert "function closeAnnouncementModal()" in app
    assert "function closeAnnouncementModalFromBackdrop(e)" in app


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
