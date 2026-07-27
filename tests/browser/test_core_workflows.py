from __future__ import annotations

import base64
import re
from pathlib import Path

import pytest
from PIL import Image
from playwright.sync_api import Page, expect

from .helpers import (
    clear_canvas,
    editor_state,
    import_image,
    paint_cells,
    pixel_signature,
    select_color,
    wait_for_history,
)


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
BLACK = "#222222"
WHITE = "#FFFFFF"
RED = "#D42F37"


pytestmark = pytest.mark.browser


def test_initial_editor_is_blank_and_uses_the_fixed_palette(
    editor_page: Page,
) -> None:
    state = editor_state(editor_page)

    assert state["gridSize"] == 24
    assert state["maxUndo"] == 100
    assert len(state["pixels"]) == 24
    assert all(len(row) == 24 for row in state["pixels"])
    assert all(color == WHITE for row in state["pixels"] for color in row)
    assert len(state["palette"]) == 64
    assert len(set(state["palette"])) == 64
    assert state["reference"]["assetId"] is None
    assert editor_page.locator("#overlayControls").is_hidden()


def test_canvas_guides_toggle_hides_visual_aids_and_persists(
    editor_page: Page,
) -> None:
    guides_button = editor_page.locator("#canvasGuidesBtn")
    assert editor_state(editor_page)["canvasGuidesVisible"] is True
    expect(guides_button).to_have_attribute("title", "隐藏辅助线")

    guides_button.click()
    assert editor_state(editor_page)["canvasGuidesVisible"] is False
    expect(guides_button).to_have_attribute("title", "显示辅助线")
    assert "active" in (guides_button.get_attribute("class") or "").split()

    select_color(editor_page, BLACK)
    paint_cells(editor_page, [(1, 1)])
    select_color(editor_page, RED)
    paint_cells(editor_page, [(2, 1)])
    rendered_colors = set(
        editor_page.locator("#pixelCanvas").evaluate(
            """canvas => {
              const pixels = canvas.getContext('2d').getImageData(
                0, 0, canvas.width, canvas.height
              ).data;
              const colors = new Set();
              for (let index = 0; index < pixels.length; index += 4) {
                colors.add(
                  '#' + [pixels[index], pixels[index + 1], pixels[index + 2]]
                    .map(value => value.toString(16).padStart(2, '0'))
                    .join('')
                    .toUpperCase()
                );
              }
              return [...colors];
            }"""
        )
    )
    assert rendered_colors <= {WHITE, BLACK, RED}

    editor_page.locator("#statisticsTab").click()
    editor_page.locator(
        '.statistics-color[data-color="#FFFFFF"]'
    ).click()
    expect(editor_page.locator("#overlayCanvas")).to_be_hidden()

    editor_page.reload(wait_until="domcontentloaded")
    editor_page.wait_for_function(
        "() => window.__TOURGRID_TEST__?.isReady === true"
    )
    assert editor_state(editor_page)["canvasGuidesVisible"] is False

    editor_page.locator("#canvasGuidesBtn").click()
    assert editor_state(editor_page)["canvasGuidesVisible"] is True


def test_replication_mode_tracks_completed_colors_and_persists_locally(
    editor_page: Page,
) -> None:
    select_color(editor_page, BLACK)
    paint_cells(editor_page, [(1, 1)])
    select_color(editor_page, RED)
    paint_cells(editor_page, [(2, 1)])

    editor_page.locator("#statisticsTab").click()
    black_stat = editor_page.locator(
        f'.statistics-color[data-color="{BLACK}"]'
    )
    black_stat.click()
    complete_control = editor_page.locator("#replicationCompleteControl")
    expect(complete_control).to_be_visible()
    complete_control.click()
    expect(
        editor_page.locator("#replicationCompleteCheckbox")
    ).to_be_checked()

    assert editor_state(editor_page)["replicationCompletedColors"] == [BLACK]
    expect(black_stat).to_have_class(re.compile(r"\bcompleted\b"))

    editor_page.locator(
        f'.statistics-color[data-color="{RED}"]'
    ).click()
    overlay_alpha = editor_page.locator("#overlayCanvas").evaluate(
        """canvas => {
          const context = canvas.getContext('2d');
          const cell = canvas.width / 24;
          const alphaAt = (x, y) => context.getImageData(
            Math.floor((x + 0.5) * cell),
            Math.floor((y + 0.5) * cell),
            1,
            1
          ).data[3];
          return {
            completed: alphaAt(1, 1),
            selected: alphaAt(2, 1),
            pending: alphaAt(3, 1)
          };
        }"""
    )
    assert overlay_alpha["completed"] == 0
    assert overlay_alpha["selected"] == 0
    assert overlay_alpha["pending"] > 0

    editor_page.reload(wait_until="domcontentloaded")
    editor_page.wait_for_function(
        "() => window.__TOURGRID_TEST__?.isReady === true"
    )
    assert editor_state(editor_page)["replicationCompletedColors"] == [BLACK]

    editor_page.locator("#statisticsTab").click()
    editor_page.locator(
        f'.statistics-color[data-color="{BLACK}"]'
    ).click()
    expect(editor_page.locator("#replicationCompleteControl")).to_be_hidden()
    expect(editor_page.locator("#replicationPreviewControl")).to_be_visible()
    editor_page.locator("#replicationCompletedViewBtn").click()
    assert editor_state(editor_page)["replicationPreviewMode"] == "completed"
    completed_preview_alpha = editor_page.locator("#overlayCanvas").evaluate(
        """canvas => {
          const context = canvas.getContext('2d');
          const cell = canvas.width / 24;
          const alphaAt = (x, y) => context.getImageData(
            Math.floor((x + 0.5) * cell),
            Math.floor((y + 0.5) * cell),
            1,
            1
          ).data[3];
          return {
            completed: alphaAt(1, 1),
            pending: alphaAt(3, 1)
          };
        }"""
    )
    assert completed_preview_alpha["completed"] == 0
    assert completed_preview_alpha["pending"] == 255

    editor_page.locator("#paletteTab").click()
    select_color(editor_page, BLACK)
    paint_cells(editor_page, [(4, 1)])
    assert editor_state(editor_page)["replicationCompletedColors"] == []


def test_move_canvas_tool_pans_without_editing_and_is_mutually_exclusive(
    editor_page: Page,
) -> None:
    initial = editor_state(editor_page)
    initial_pixels = pixel_signature(initial)
    initial_undo_depth = initial["undoDepth"]

    editor_page.locator("#zoomSlider").evaluate(
        """slider => {
          slider.value = '400';
          slider.dispatchEvent(new Event('input', {bubbles: true}));
        }"""
    )
    move_button = editor_page.locator("#moveCanvasBtn")
    move_button.click()
    assert editor_state(editor_page)["moveCanvasActive"] is True
    expect(move_button).to_have_attribute("aria-pressed", "true")

    container = editor_page.locator("#canvasContainer")
    box = container.bounding_box()
    assert box is not None
    before_scroll = container.evaluate(
        "element => ({left: element.scrollLeft, top: element.scrollTop})"
    )
    start_x = box["x"] + box["width"] / 2
    start_y = box["y"] + box["height"] / 2
    editor_page.mouse.move(start_x, start_y)
    editor_page.mouse.down()
    editor_page.mouse.move(start_x - 90, start_y - 70, steps=8)
    editor_page.mouse.up()
    after_scroll = container.evaluate(
        "element => ({left: element.scrollLeft, top: element.scrollTop})"
    )

    assert after_scroll["left"] > before_scroll["left"]
    assert after_scroll["top"] > before_scroll["top"]
    moved = editor_state(editor_page)
    assert pixel_signature(moved) == initial_pixels
    assert moved["undoDepth"] == initial_undo_depth

    editor_page.locator("#eyedropperBtn").click()
    exclusive = editor_state(editor_page)
    assert exclusive["moveCanvasActive"] is False
    editor_page.keyboard.press("Escape")

    move_button.click()
    editor_page.keyboard.press("Escape")
    assert editor_state(editor_page)["moveCanvasActive"] is False


def test_continuous_stroke_is_one_undo_step_and_can_be_redone(
    editor_page: Page,
) -> None:
    select_color(editor_page, BLACK)
    cells = [(2, 3), (3, 3), (4, 3)]
    paint_cells(editor_page, cells)

    painted = editor_state(editor_page)
    assert painted["undoDepth"] == 1
    assert painted["redoDepth"] == 0
    assert all(painted["pixels"][y][x] == BLACK for x, y in cells)

    editor_page.locator("#undoBtn").click()
    wait_for_history(editor_page)
    undone = editor_state(editor_page)
    assert all(undone["pixels"][y][x] == WHITE for x, y in cells)
    assert undone["redoDepth"] == 1

    editor_page.locator("#redoBtn").click()
    wait_for_history(editor_page)
    redone = editor_state(editor_page)
    assert all(redone["pixels"][y][x] == BLACK for x, y in cells)


def test_statistics_mode_keeps_the_canvas_read_only(
    editor_page: Page,
) -> None:
    select_color(editor_page, BLACK)
    paint_cells(editor_page, [(5, 5)])
    before = pixel_signature(editor_state(editor_page))

    editor_page.locator("#statisticsTab").click()
    expect(editor_page.locator("#undoBtn")).to_be_disabled()
    paint_cells(editor_page, [(6, 6)])

    after = editor_state(editor_page)
    assert after["palettePanelMode"] == "statistics"
    assert pixel_signature(after) == before


def test_local_import_is_24_by_24_and_palette_limited(
    editor_page: Page,
) -> None:
    state = import_image(
        editor_page,
        FIXTURES / "avatar-reference-synthetic.png",
    )

    assert state["gridSize"] == 24
    assert state["reference"]["assetId"].startswith("reference-")
    assert state["reference"]["width"] == 256
    assert state["reference"]["height"] == 256
    assert {
        color for row in state["pixels"] for color in row
    }.issubset(set(state["palette"]))


def test_import_clear_undo_and_redo_restore_the_complete_document(
    editor_page: Page,
) -> None:
    imported = import_image(
        editor_page,
        FIXTURES / "avatar-reference-synthetic.png",
    )
    imported_pixels = pixel_signature(imported)
    imported_reference = imported["reference"]["assetId"]

    clear_canvas(editor_page)
    cleared = editor_state(editor_page)
    assert all(color == WHITE for row in cleared["pixels"] for color in row)
    assert cleared["reference"]["assetId"] is None
    expect(editor_page.locator("#overlayControls")).to_be_hidden()

    editor_page.locator("#undoBtn").click()
    wait_for_history(editor_page)
    restored = editor_state(editor_page)
    assert pixel_signature(restored) == imported_pixels
    assert restored["reference"]["assetId"] == imported_reference
    assert restored["referenceLoaded"] is True
    expect(editor_page.locator("#overlayControls")).to_be_visible()

    editor_page.locator("#redoBtn").click()
    wait_for_history(editor_page)
    redone = editor_state(editor_page)
    assert all(color == WHITE for row in redone["pixels"] for color in row)
    assert redone["reference"]["assetId"] is None


def test_two_imports_can_be_undone_and_redone_with_their_references(
    editor_page: Page,
) -> None:
    first = import_image(editor_page, FIXTURES / "landscape-scene.png")
    first_pixels = pixel_signature(first)
    first_reference = first["reference"]["assetId"]

    second = import_image(editor_page, FIXTURES / "portrait-scene.png")
    second_pixels = pixel_signature(second)
    second_reference = second["reference"]["assetId"]
    assert second_reference != first_reference
    assert second_pixels != first_pixels

    editor_page.locator("#undoBtn").click()
    wait_for_history(editor_page)
    undone = editor_state(editor_page)
    assert pixel_signature(undone) == first_pixels
    assert undone["reference"]["assetId"] == first_reference

    editor_page.locator("#redoBtn").click()
    wait_for_history(editor_page)
    redone = editor_state(editor_page)
    assert pixel_signature(redone) == second_pixels
    assert redone["reference"]["assetId"] == second_reference


def test_refresh_restores_pixels_reference_and_reference_controls(
    editor_page: Page,
) -> None:
    imported = import_image(
        editor_page,
        FIXTURES / "transparent-subject.png",
    )
    signature = pixel_signature(imported)
    reference_id = imported["reference"]["assetId"]

    editor_page.locator("#overlayToggleBtn").click()
    editor_page.locator("#overlayOpacity").fill("70")
    editor_page.reload(wait_until="domcontentloaded")
    editor_page.wait_for_function(
        "() => window.__TOURGRID_TEST__?.isReady === true"
    )
    editor_page.wait_for_function(
        "() => window.__TOURGRID_TEST__.getState().referenceLoaded"
    )

    restored = editor_state(editor_page)
    assert pixel_signature(restored) == signature
    assert restored["reference"]["assetId"] == reference_id
    assert restored["overlayVisible"] is True
    assert restored["overlayOpacity"] == pytest.approx(0.7)

    clear_canvas(editor_page)
    editor_page.reload(wait_until="domcontentloaded")
    editor_page.wait_for_function(
        "() => window.__TOURGRID_TEST__?.isReady === true"
    )
    blank = editor_state(editor_page)
    assert all(color == WHITE for row in blank["pixels"] for color in row)
    assert blank["reference"]["assetId"] is None


def test_manual_checkpoint_restores_document_and_can_be_undone(
    editor_page: Page,
) -> None:
    first = import_image(editor_page, FIXTURES / "landscape-scene.png")
    first_pixels = pixel_signature(first)
    first_reference = first["reference"]["assetId"]

    editor_page.locator("#manualCheckpointSaveBtn").click()
    assert editor_state(editor_page)["manualCheckpointExists"] is True

    second = import_image(editor_page, FIXTURES / "portrait-scene.png")
    second_pixels = pixel_signature(second)
    second_reference = second["reference"]["assetId"]
    assert second_reference != first_reference

    editor_page.once("dialog", lambda dialog: dialog.accept())
    editor_page.locator("#manualCheckpointRestoreBtn").click()
    editor_page.wait_for_function(
        "(assetId) => window.__TOURGRID_TEST__.getState()"
        ".reference.assetId === assetId",
        arg=first_reference,
    )
    wait_for_history(editor_page)
    restored = editor_state(editor_page)
    assert pixel_signature(restored) == first_pixels
    assert restored["referenceLoaded"] is True

    editor_page.locator("#undoBtn").click()
    wait_for_history(editor_page)
    undone = editor_state(editor_page)
    assert pixel_signature(undone) == second_pixels
    assert undone["reference"]["assetId"] == second_reference


def test_raw_png_export_is_24_by_24_and_palette_limited(
    editor_page: Page,
    tmp_path: Path,
) -> None:
    select_color(editor_page, BLACK)
    paint_cells(editor_page, [(0, 0), (1, 0), (2, 0)])

    editor_page.locator(".btn-primary").click()
    with editor_page.expect_download() as download_info:
        editor_page.locator(
            '#exportDropdown .export-item[onclick="exportRawPixelImage()"]'
        ).click()
    download = download_info.value
    output = tmp_path / download.suggested_filename
    download.save_as(output)

    with Image.open(output) as exported:
        assert exported.size == (24, 24)
        assert exported.format == "PNG"
        colors = {
            "#%02X%02X%02X" % pixel[:3]
            for pixel in exported.convert("RGB").get_flattened_data()
        }
    assert colors.issubset(set(editor_state(editor_page)["palette"]))


def test_shared_work_publish_and_load_round_trip(editor_page: Page) -> None:
    code = "7Kp3mXqB4NzR"
    all_black_payload = base64.b64encode(bytes(432)).decode("ascii")
    published_payload: dict[str, object] = {}

    def handle_publish(route) -> None:
        published_payload.update(route.request.post_data_json)
        route.fulfill(
            status=201,
            content_type="application/json",
            body=(
                '{"code":"' + code + '","schemaVersion":1,'
                '"paletteId":"natural-64-v1","paletteVersion":1,'
                '"pixels":"' + published_payload["pixels"] + '",'
                '"authorName":"博士","title":"很糊的画","viewCount":0,'
                '"createdAt":"2026-07-27T00:00:00Z"}'
            ),
        )

    def handle_load(route) -> None:
        route.fulfill(
            status=200,
            content_type="application/json",
            body=(
                '{"code":"' + code + '","schemaVersion":1,'
                '"paletteId":"natural-64-v1","paletteVersion":1,'
                '"pixels":"' + all_black_payload + '",'
                '"authorName":"博士","title":"很糊的画","viewCount":1,'
                '"createdAt":"2026-07-27T00:00:00Z"}'
            ),
        )

    editor_page.route("**/api/v1/works", handle_publish)
    editor_page.route(f"**/api/v1/works/{code}", handle_load)

    select_color(editor_page, BLACK)
    paint_cells(editor_page, [(1, 1)])
    before_load = pixel_signature(editor_state(editor_page))

    editor_page.locator(".btn-primary").click()
    editor_page.get_by_role("button", name="保存并分享作品").click()
    expect(editor_page.locator("#workTitleInput")).to_have_value("很糊的画")
    expect(editor_page.locator("#workAuthorInput")).to_have_value("博士")
    editor_page.locator("#publishWorkButton").click()
    expect(editor_page.locator("#publishedWorkCode")).to_have_text(code)
    editor_page.context.grant_permissions(
        ["clipboard-read", "clipboard-write"],
        origin=editor_page.evaluate("location.origin"),
    )
    editor_page.locator("#publishedWorkCode").click()
    assert editor_page.evaluate("navigator.clipboard.readText()") == code

    assert published_payload["schemaVersion"] == 1
    assert published_payload["paletteId"] == "natural-64-v1"
    assert published_payload["title"] == "很糊的画"
    assert published_payload["authorName"] == "博士"
    encoded = str(published_payload["pixels"])
    assert len(encoded) == 576
    assert len(base64.b64decode(encoded)) == 432

    editor_page.locator("#workCodeInput").fill(code)
    editor_page.locator("#loadWorkButton").click()
    expect(editor_page.locator("#toast")).to_contain_text(
        "已读取《很糊的画》 · 作者：博士"
    )
    expect(editor_page.locator("#workShareModal")).to_be_hidden()
    loaded = editor_state(editor_page)
    assert all(color == BLACK for row in loaded["pixels"] for color in row)
    expect(editor_page.locator("#topWorkTitle")).to_have_text("《很糊的画》")
    expect(editor_page.locator("#topWorkMeta")).to_contain_text("作者：博士")
    expect(editor_page.locator("#topWorkMeta")).to_contain_text("分享次数：1")
    expect(editor_page.locator("#topWorkMeta")).to_contain_text(code)

    select_color(editor_page, RED)
    paint_cells(editor_page, [(0, 0)])
    expect(editor_page.locator("#topWorkTitle")).to_have_text(
        "《巡展像素》非官方编辑器"
    )
    expect(editor_page.locator("#topWorkMeta")).to_be_hidden()

    editor_page.locator("#undoBtn").click()
    wait_for_history(editor_page)
    expect(editor_page.locator("#topWorkTitle")).to_have_text("《很糊的画》")

    editor_page.locator("#undoBtn").click()
    wait_for_history(editor_page)
    assert pixel_signature(editor_state(editor_page)) == before_load
    expect(editor_page.locator("#topWorkTitle")).to_have_text(
        "《巡展像素》非官方编辑器"
    )
