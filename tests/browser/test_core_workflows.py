from __future__ import annotations

import base64
import re
from pathlib import Path

import pytest
from PIL import Image
from playwright.sync_api import Page, expect

from .helpers import (
    click_canvas_cell,
    clear_canvas,
    editor_state,
    import_image,
    paint_cells,
    pixel_signature,
    select_color,
    wait_for_history,
)


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
BLACK = "#242424"
WHITE = "#FFFFFF"
RED = "#D22F34"


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


def test_replacement_mode_replaces_multiple_colors_with_one_undo(
    editor_page: Page,
) -> None:
    select_color(editor_page, BLACK)
    paint_cells(editor_page, [(1, 1), (3, 1)])
    select_color(editor_page, RED)
    paint_cells(editor_page, [(2, 1)])

    editor_page.locator("#replacementTab").click()
    assert editor_state(editor_page)["workspacePanelMode"] == "replacement"
    expect(editor_page.locator("#replacementHint")).to_be_visible()
    black = editor_page.locator(
        f'.color-statistics-color[data-color="{BLACK}"]'
    )
    white = editor_page.locator(
        f'.color-statistics-color[data-color="{WHITE}"]'
    )
    assert editor_page.locator(
        "#replacementGrid .color-statistics-color"
    ).count() == 64
    related_button = editor_page.locator("#replacementRelatedBtn")
    expect(related_button).to_be_disabled()
    statistics_sort = editor_page.locator("#replacementSort")
    statistics_sort.select_option("count-asc")
    ascending_counts = editor_page.locator(
        "#replacementGrid"
    ).evaluate(
        """grid => Array.from(
          grid.querySelectorAll('.color-statistics-color')
        ).map(item => Number(
          item.querySelector('.statistics-count').textContent.slice(1)
        ))"""
    )
    assert ascending_counts == sorted(ascending_counts)

    statistics_sort.select_option("palette-order")
    palette_order = editor_state(editor_page)["palette"]
    palette_indices = {
        color: index for index, color in enumerate(palette_order)
    }
    ordered_colors = editor_page.locator("#replacementGrid").evaluate(
        """grid => Array.from(
          grid.querySelectorAll('.color-statistics-color')
        ).map(item => item.dataset.color)"""
    )
    assert [palette_indices[color] for color in ordered_colors] == sorted(
        palette_indices[color] for color in ordered_colors
    )
    statistics_sort.select_option("count-desc")

    editor_page.locator("#eyedropperBtn").click()
    assert editor_state(editor_page)["eyedropperActive"] is True
    order_before_selection = editor_state(editor_page)[
        "replacementOrderedColors"
    ]
    click_canvas_cell(editor_page, 1, 1)
    assert editor_state(editor_page)["eyedropperActive"] is False
    expect(related_button).to_be_enabled()
    assert (
        editor_state(editor_page)["replacementOrderedColors"]
        == order_before_selection
    )
    related_button.click()
    related_state = editor_state(editor_page)
    assert related_state["replacementRelatedSourceColor"] == BLACK
    assert 5 <= len(related_state["replacementRelatedColors"]) <= 8
    assert related_state["replacementOrderedColors"][0] == BLACK
    assert related_state["replacementOrderedColors"][1:8] == (
        related_state["replacementRelatedColors"]
    )
    related_divider = editor_page.locator(
        "#replacementGrid .replacement-related-divider"
    )
    expect(related_divider).to_have_count(1)
    assert related_divider.evaluate(
        "divider => Array.from(divider.parentElement.children).indexOf(divider)"
    ) == 8
    source_only_overlay = editor_page.locator(
        "#statisticsOverlayCanvas"
    ).evaluate(
        """canvas => {
          const context = canvas.getContext('2d');
          const cell = canvas.width / 24;
          const alphaAt = (pixelX, pixelY) => context.getImageData(
            Math.floor(pixelX),
            Math.floor(pixelY),
            1,
            1
          ).data[3];
          return {
            sourceHighlight: alphaAt(1 * cell + 1, 1 * cell + 1),
            unselectedCenter: alphaAt(2.5 * cell, 1.5 * cell)
          };
        }"""
    )
    assert source_only_overlay["sourceHighlight"] > 0
    assert 35 <= source_only_overlay["unselectedCenter"] <= 60
    white.click()
    expect(related_button).to_be_disabled()
    assert editor_state(editor_page)["replacementOrderedColors"] == (
        related_state["replacementOrderedColors"]
    )
    expect(editor_page.locator("#replacementSelectionSummary")).to_have_text(
        "已选择 2 种颜色 · 共 575 格"
    )
    expect(black).to_have_class(re.compile(r"\bsource-selected\b"))
    expect(white).to_have_class(re.compile(r"\bsource-selected\b"))

    editor_page.locator("#replacementStartBtn").click()
    red = editor_page.locator(
        f'.color-statistics-color[data-color="{RED}"]'
    )
    red.click()
    state = editor_state(editor_page)
    assert state["replacementTargetMode"] is True
    assert state["replacementSelectedColors"] == [BLACK, WHITE]
    assert state["replacementTargetColor"] == RED
    assert state["pixels"][1][1] == BLACK
    assert state["pixels"][1][2] == RED
    assert state["pixels"][0][0] == WHITE
    expect(red).to_have_class(re.compile(r"\breplacement-target\b"))
    expect(editor_page.locator("#statisticsOverlayCanvas")).to_be_visible()

    overlay_feedback = editor_page.locator("#statisticsOverlayCanvas").evaluate(
        """canvas => {
          const context = canvas.getContext('2d');
          const cell = canvas.width / 24;
          const center = (x, y) => Array.from(context.getImageData(
            Math.floor((x + 0.5) * cell),
            Math.floor((y + 0.5) * cell),
            1,
            1
          ).data);
          const edge = (x, y) => Array.from(context.getImageData(
            Math.floor(x * cell + 1),
            Math.floor(y * cell + 1),
            1,
            1
          ).data);
          return {
            sourcePreview: center(1, 1),
            existingTargetCenter: center(2, 1),
            existingTargetEdge: edge(2, 1)
          };
        }"""
    )
    assert overlay_feedback["sourcePreview"] == [210, 47, 52, 255]
    assert overlay_feedback["existingTargetCenter"][3] == 0
    assert overlay_feedback["existingTargetEdge"][3] == 0

    editor_page.locator("#replacementCancelBtn").click()
    state = editor_state(editor_page)
    assert state["replacementTargetMode"] is False
    assert state["replacementSelectedColors"] == [BLACK, WHITE]
    assert state["replacementTargetColor"] is None

    before_replace = editor_state(editor_page)
    editor_page.locator("#replacementStartBtn").click()
    editor_page.locator(
        f'.color-statistics-color[data-color="{RED}"]'
    ).click()
    editor_page.locator("#replacementConfirmBtn").click()
    replaced = editor_state(editor_page)
    assert replaced["undoDepth"] == before_replace["undoDepth"] + 1
    assert replaced["replacementSelectedColors"] == []
    expect(editor_page.locator(
        "#replacementGrid .replacement-related-divider"
    )).to_have_count(0)
    assert all(
        color == RED
        for row in replaced["pixels"]
        for color in row
    )

    editor_page.locator("#undoBtn").click()
    wait_for_history(editor_page)
    restored = editor_state(editor_page)
    assert restored["pixels"][1][1] == BLACK
    assert restored["pixels"][1][2] == RED
    assert restored["pixels"][0][0] == WHITE

    editor_page.locator(
        f'.color-statistics-color[data-color="{BLACK}"]'
    ).click()
    editor_page.locator("#replacementStartBtn").click()
    editor_page.locator(
        f'.color-statistics-color[data-color="{RED}"]'
    ).click()
    editor_page.locator("#coloringTab").click()
    state = editor_state(editor_page)
    assert state["replacementTargetMode"] is False
    assert state["replacementTargetColor"] is None
    assert state["replacementSelectedColors"] == [BLACK]

    editor_page.locator("#replacementTab").click()
    clear_canvas(editor_page)
    state = editor_state(editor_page)
    assert state["replacementSelectedColors"] == []


def test_keyboard_shortcuts_are_scoped_away_from_form_controls(
    editor_page: Page,
) -> None:
    select_color(editor_page, BLACK)
    paint_cells(editor_page, [(1, 1)])
    before_input = editor_state(editor_page)

    editor_page.locator(".btn-primary").click()
    editor_page.get_by_role("button", name="保存并分享作品").click()
    title_input = editor_page.locator("#workTitleInput")
    title_input.fill("")
    title_input.type("BE")
    editor_page.keyboard.press("Control+z")

    protected = editor_state(editor_page)
    assert protected["currentColor"] == BLACK
    assert protected["undoDepth"] == before_input["undoDepth"]
    assert pixel_signature(protected) == pixel_signature(before_input)

    editor_page.keyboard.press("Escape")
    expect(editor_page.locator("#workShareModal")).to_be_hidden()

    editor_page.keyboard.press("e")
    assert editor_state(editor_page)["currentColor"] == WHITE

    editor_page.keyboard.press("s")
    assert editor_state(editor_page)["manualCheckpointExists"] is True

    guides_before = editor_state(editor_page)["canvasGuidesVisible"]
    editor_page.keyboard.press("g")
    assert editor_state(editor_page)["canvasGuidesVisible"] is not guides_before

    editor_page.keyboard.press("i")
    assert editor_state(editor_page)["eyedropperActive"] is True
    editor_page.keyboard.press("m")
    state = editor_state(editor_page)
    assert state["eyedropperActive"] is False
    assert state["moveCanvasActive"] is True
    editor_page.keyboard.press("Escape")
    assert editor_state(editor_page)["moveCanvasActive"] is False

    canvas = editor_page.locator("#pixelCanvas")
    editor_page.keyboard.down("h")
    expect(canvas).to_have_css("cursor", "grab")
    editor_page.keyboard.up("h")
    expect(canvas).to_have_css("cursor", "crosshair")


def test_canvas_guides_toggle_hides_visual_aids_and_persists(
    editor_page: Page,
) -> None:
    guides_button = editor_page.locator("#canvasGuidesBtn")
    assert editor_state(editor_page)["canvasGuidesVisible"] is True
    expect(guides_button).to_have_attribute("title", "隐藏辅助线（G）")

    guides_button.click()
    assert editor_state(editor_page)["canvasGuidesVisible"] is False
    expect(guides_button).to_have_attribute("title", "显示辅助线（G）")
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

    editor_page.locator("#replicationTab").click()
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
    paint_cells(editor_page, [(3, 1)])
    select_color(editor_page, RED)
    paint_cells(editor_page, [(2, 1)])

    editor_page.locator("#replicationTab").click()
    editor_page.locator("#replicationSort").select_option("palette-order")
    sort_state = editor_state(editor_page)
    assert sort_state["replicationSortMode"] == "palette-order"
    assert sort_state["replacementSortMode"] == "count-desc"
    black_stat = editor_page.locator(
        f'.statistics-color[data-color="{BLACK}"]'
    )
    black_stat.click()
    complete_control = editor_page.locator("#replicationCompleteControl")
    expect(complete_control).to_be_visible()
    complete_checkbox = editor_page.locator("#replicationCompleteCheckbox")

    click_canvas_cell(editor_page, 1, 1)
    expect(complete_checkbox).not_to_be_checked()
    state = editor_state(editor_page)
    assert state["replicationCompletedCells"] == [25]
    assert state["replicationCompletedColors"] == []
    expect(black_stat).not_to_have_class(re.compile(r"\bcompleted\b"))

    editor_page.reload(wait_until="domcontentloaded")
    editor_page.wait_for_function(
        "() => window.__TOURGRID_TEST__?.isReady === true"
    )
    state = editor_state(editor_page)
    assert state["replicationCompletedCells"] == [25]
    assert state["replicationCompletedColors"] == []

    editor_page.locator("#replicationTab").click()
    black_stat = editor_page.locator(
        f'.statistics-color[data-color="{BLACK}"]'
    )
    black_stat.click()
    editor_page.locator("#moveCanvasBtn").click()
    click_canvas_cell(editor_page, 3, 1)
    assert editor_state(editor_page)["replicationCompletedCells"] == [25]
    editor_page.keyboard.press("Escape")
    canvas = editor_page.locator("#pixelCanvas")
    canvas_box = canvas.bounding_box()
    assert canvas_box is not None
    cell_width = canvas_box["width"] / 24
    cell_height = canvas_box["height"] / 24
    row_y = canvas_box["y"] + 1.5 * cell_height
    editor_page.mouse.move(
        canvas_box["x"] + 1.5 * cell_width,
        row_y,
    )
    editor_page.mouse.down()
    editor_page.mouse.move(canvas_box["x"] - 20, row_y)
    editor_page.mouse.move(
        canvas_box["x"] + 3.5 * cell_width,
        row_y,
    )
    editor_page.mouse.up()
    expect(editor_page.locator("#replicationCompleteCheckbox")).to_be_checked()
    state = editor_state(editor_page)
    assert state["replicationCompletedCells"] == [25, 27]
    assert state["replicationCompletedColors"] == [BLACK]
    expect(black_stat).to_have_class(re.compile(r"\bcompleted\b"))

    complete_control.click()
    expect(editor_page.locator("#replicationCompleteCheckbox")).not_to_be_checked()
    assert editor_state(editor_page)["replicationCompletedCells"] == []
    complete_control.click()
    expect(editor_page.locator("#replicationCompleteCheckbox")).to_be_checked()
    assert editor_state(editor_page)["replicationCompletedCells"] == [25, 27]

    editor_page.locator(
        f'.statistics-color[data-color="{RED}"]'
    ).click()
    overlay_alpha = editor_page.locator("#statisticsOverlayCanvas").evaluate(
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
            pending: alphaAt(4, 1)
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
    state = editor_state(editor_page)
    assert state["replicationCompletedCells"] == [25, 27]
    assert state["replicationCompletedColors"] == [BLACK]

    editor_page.locator("#replicationTab").click()
    expect(editor_page.locator("#replicationCompleteControl")).to_be_hidden()
    expect(editor_page.locator("#replicationPreviewControl")).to_be_visible()
    editor_page.locator("#replicationCompletedViewBtn").click()
    assert editor_state(editor_page)["replicationPreviewMode"] == "completed"
    completed_preview_alpha = editor_page.locator(
        "#statisticsOverlayCanvas"
    ).evaluate(
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
            pending: alphaAt(4, 1)
          };
        }"""
    )
    assert completed_preview_alpha["completed"] == 0
    assert completed_preview_alpha["pending"] == 255

    editor_page.once("dialog", lambda dialog: dialog.accept())
    editor_page.locator("#replicationResetBtn").click()
    assert editor_state(editor_page)["replicationCompletedCells"] == []
    assert editor_state(editor_page)["replicationCompletedColors"] == []

    editor_page.locator(
        f'.statistics-color[data-color="{BLACK}"]'
    ).click()
    editor_page.locator("#replicationCompleteControl").click()
    state = editor_state(editor_page)
    assert state["replicationCompletedCells"] == [25, 27]
    assert state["replicationCompletedColors"] == [BLACK]

    editor_page.locator("#coloringTab").click()
    select_color(editor_page, RED)
    paint_cells(editor_page, [(1, 1)])
    state = editor_state(editor_page)
    assert state["replicationCompletedCells"] == [27]
    assert state["replicationCompletedColors"] == [BLACK]

    select_color(editor_page, BLACK)
    paint_cells(editor_page, [(4, 1)])
    state = editor_state(editor_page)
    assert state["replicationCompletedCells"] == [27]
    assert state["replicationCompletedColors"] == []

    editor_page.reload(wait_until="domcontentloaded")
    editor_page.wait_for_function(
        "() => window.__TOURGRID_TEST__?.isReady === true"
    )
    state = editor_state(editor_page)
    assert state["replicationCompletedCells"] == [27]
    assert state["replicationCompletedColors"] == []

    editor_page.locator("#replicationTab").click()
    editor_page.locator(
        f'.statistics-color[data-color="{BLACK}"]'
    ).click()
    expect(editor_page.locator("#replicationCompleteCheckbox")).not_to_be_checked()


def test_legacy_completed_color_progress_migrates_to_completed_cells(
    editor_page: Page,
) -> None:
    select_color(editor_page, BLACK)
    paint_cells(editor_page, [(1, 1)])
    paint_cells(editor_page, [(3, 1)])
    fingerprint = editor_page.evaluate("() => replicationWorkFingerprint()")
    editor_page.evaluate(
        """([key, fingerprint, color]) => {
          localStorage.setItem(key, JSON.stringify({
            version: 1,
            works: {
              [fingerprint]: {
                completedColors: [color],
                updatedAt: Date.now()
              }
            }
          }));
        }""",
        ["tourgrid_replication_progress_v2", fingerprint, BLACK],
    )

    editor_page.reload(wait_until="domcontentloaded")
    editor_page.wait_for_function(
        "() => window.__TOURGRID_TEST__?.isReady === true"
    )
    state = editor_state(editor_page)
    assert state["replicationCompletedCells"] == [25, 27]
    assert state["replicationCompletedColors"] == [BLACK]
    stored = editor_page.evaluate(
        """([key, fingerprint]) => {
          const store = JSON.parse(localStorage.getItem(key));
          return {
            version: store.version,
            record: store.works[fingerprint]
          };
        }""",
        ["tourgrid_replication_progress_v2", fingerprint],
    )
    assert stored["version"] == 2
    assert stored["record"]["completedCells"] == [25, 27]
    assert "completedColors" not in stored["record"]


def test_replication_opens_without_selection_and_preserves_palette_choice(
    editor_page: Page,
) -> None:
    select_color(editor_page, RED)
    editor_page.locator("#replicationTab").click()
    state = editor_state(editor_page)
    assert state["replicationHighlightColor"] is None
    expect(editor_page.locator("#replicationPreviewControl")).to_be_visible()

    editor_page.locator("#coloringTab").click()
    assert editor_state(editor_page)["currentColor"] == RED


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

    canvas = editor_page.locator("#pixelCanvas")
    expect(canvas).to_have_css("cursor", "grab")
    editor_page.locator("#eyedropperBtn").click()
    exclusive = editor_state(editor_page)
    assert exclusive["moveCanvasActive"] is False
    assert exclusive["eyedropperActive"] is True
    expect(canvas).to_have_css("cursor", "crosshair")
    editor_page.keyboard.press("Escape")

    move_button.click()
    expect(canvas).to_have_css("cursor", "grab")
    editor_page.keyboard.press("Escape")
    assert editor_state(editor_page)["moveCanvasActive"] is False
    editor_page.locator("#eyedropperBtn").click()
    assert editor_state(editor_page)["eyedropperActive"] is True
    expect(canvas).to_have_css("cursor", "crosshair")


def test_canvas_cell_hover_preview_and_outline_follow_editor_mode(
    editor_page: Page,
) -> None:
    canvas = editor_page.locator("#pixelCanvas")
    hover_canvas = editor_page.locator("#hoverCanvas")
    baseline = hover_canvas.evaluate("element => element.toDataURL()")
    box = canvas.bounding_box()
    assert box is not None

    def move_to_cell(x: int, y: int) -> None:
        editor_page.mouse.move(
            box["x"] + (x + 0.5) * box["width"] / 24,
            box["y"] + (y + 0.5) * box["height"] / 24,
        )

    move_to_cell(3, 4)
    assert editor_state(editor_page)["hoveredCanvasCell"] == {"x": 3, "y": 4}
    assert hover_canvas.evaluate("element => element.toDataURL()") != baseline
    preview_pixel = hover_canvas.evaluate(
        """canvas => canvas.getContext('2d').getImageData(
          Math.floor((3.5 / 24) * canvas.width),
          Math.floor((4.5 / 24) * canvas.height),
          1,
          1
        ).data"""
    )
    assert preview_pixel == [36, 36, 36, 255]

    editor_page.evaluate(
        """
        () => {
          onTouchStart({
            preventDefault() {},
            touches: [
              {clientX: 20, clientY: 20},
              {clientX: 40, clientY: 40}
            ]
          });
          onTouchEnd({});
        }
        """
    )
    assert editor_state(editor_page)["hoveredCanvasCell"] is None
    assert hover_canvas.evaluate("element => element.toDataURL()") == baseline

    editor_page.locator("#eyedropperBtn").click()
    move_to_cell(5, 6)
    state = editor_state(editor_page)
    assert state["eyedropperActive"] is True
    assert state["hoveredCanvasCell"] == {"x": 5, "y": 6}
    assert hover_canvas.evaluate("element => element.toDataURL()") != baseline
    eyedropper_center_alpha = hover_canvas.evaluate(
        """canvas => canvas.getContext('2d').getImageData(
          Math.floor((5.5 / 24) * canvas.width),
          Math.floor((6.5 / 24) * canvas.height),
          1,
          1
        ).data[3]"""
    )
    assert eyedropper_center_alpha == 0

    editor_page.locator("#moveCanvasBtn").click()
    move_to_cell(7, 8)
    state = editor_state(editor_page)
    assert state["moveCanvasActive"] is True
    assert state["hoveredCanvasCell"] is None
    assert hover_canvas.evaluate("element => element.toDataURL()") == baseline

    editor_page.keyboard.press("Escape")
    editor_page.locator("#replicationTab").click()
    move_to_cell(9, 10)
    state = editor_state(editor_page)
    assert state["hoveredCanvasCell"] == {"x": 9, "y": 10}
    assert hover_canvas.evaluate("element => element.toDataURL()") != baseline
    replication_center_alpha = hover_canvas.evaluate(
        """canvas => canvas.getContext('2d').getImageData(
          Math.floor((9.5 / 24) * canvas.width),
          Math.floor((10.5 / 24) * canvas.height),
          1,
          1
        ).data[3]"""
    )
    assert replication_center_alpha == 0


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


def test_replication_mode_keeps_the_canvas_read_only(
    editor_page: Page,
) -> None:
    select_color(editor_page, BLACK)
    paint_cells(editor_page, [(5, 5)])
    before = pixel_signature(editor_state(editor_page))

    editor_page.locator("#replicationTab").click()
    expect(editor_page.locator("#undoBtn")).to_be_disabled()
    paint_cells(editor_page, [(6, 6)])

    after = editor_state(editor_page)
    assert after["workspacePanelMode"] == "replication"
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


def test_import_adjustments_update_preview_and_limit_target_colors(
    editor_page: Page,
) -> None:
    editor_page.locator("#importFileInput").set_input_files(
        str(FIXTURES / "portrait-scene.png")
    )
    expect(editor_page.locator("#cropOverlay")).to_be_visible()
    preview = editor_page.locator("#cropPreviewCanvas")
    editor_page.wait_for_function(
        "() => document.querySelector('#cropPreviewSummary')"
        ".textContent.includes('像素结果使用')"
    )
    baseline = preview.evaluate("canvas => canvas.toDataURL()")

    editor_page.locator("#cropContrast").fill("135")
    editor_page.locator("#cropBrightness").fill("110")
    editor_page.locator("#cropSaturation").fill("125")
    editor_page.locator("#cropColorOverlay").fill("#E53E3E")
    editor_page.locator("#cropColorOverlayOpacity").fill("30")
    editor_page.locator("#cropTargetColorCount").fill("8")
    expect(editor_page.locator("#cropTargetColorCountVal")).to_have_text("8 色")
    editor_page.wait_for_timeout(150)
    assert preview.evaluate("canvas => canvas.toDataURL()") != baseline

    editor_page.locator("#cropPreviewToggleBtn").click()
    expect(editor_page.locator("#cropPreviewToggleBtn")).to_have_attribute(
        "aria-pressed",
        "true",
    )
    expect(editor_page.locator("#cropPreviewToggleBtn")).to_have_text("查看原图")
    expect(editor_page.locator("#cropPreviewBadge")).to_have_text("像素化结果")
    expect(editor_page.locator("#cropPreviewSummary")).to_contain_text(
        "像素结果使用"
    )

    editor_page.locator("#confirmCropBtn").click()
    expect(editor_page.locator("#cropOverlay")).to_be_hidden(timeout=15_000)
    state = editor_state(editor_page)
    used_colors = {color for row in state["pixels"] for color in row}
    assert state["gridSize"] == 24
    assert len(used_colors) <= 8
    assert used_colors.issubset(set(state["palette"]))


def test_import_dither_modes_and_strength_update_pixel_preview(
    editor_page: Page,
) -> None:
    editor_page.locator("#importFileInput").set_input_files(
        str(FIXTURES / "large-pattern.png")
    )
    expect(editor_page.locator("#cropOverlay")).to_be_visible()
    strength_control = editor_page.locator("#cropDitherStrengthControl")
    expect(strength_control).to_be_hidden()

    editor_page.locator("#cropDither").select_option("floyd")
    expect(strength_control).to_be_visible()
    editor_page.locator("#cropDitherStrength").fill("0")
    expect(editor_page.locator("#cropDitherStrengthVal")).to_have_text("0%")
    editor_page.locator("#cropPreviewToggleBtn").click()
    editor_page.wait_for_timeout(150)
    preview = editor_page.locator("#cropPreviewCanvas")
    zero_strength = preview.evaluate("canvas => canvas.toDataURL()")

    editor_page.locator("#cropDither").select_option("none")
    expect(strength_control).to_be_hidden()
    editor_page.wait_for_timeout(150)
    no_dither = preview.evaluate("canvas => canvas.toDataURL()")
    assert zero_strength == no_dither

    editor_page.locator("#cropDither").select_option("bayer2")
    expect(strength_control).to_be_visible()
    editor_page.locator("#cropTargetColorCount").fill("12")
    editor_page.locator("#cropDitherStrength").fill("100")
    editor_page.wait_for_timeout(150)
    bayer2 = preview.evaluate("canvas => canvas.toDataURL()")

    editor_page.locator("#cropDither").select_option("bayer4")
    editor_page.wait_for_timeout(150)
    bayer4 = preview.evaluate("canvas => canvas.toDataURL()")
    assert bayer2 != no_dither
    assert bayer4 != no_dither
    assert bayer2 != bayer4

    editor_page.locator("#confirmCropBtn").click()
    expect(editor_page.locator("#cropOverlay")).to_be_hidden(timeout=15_000)
    state = editor_state(editor_page)
    used_colors = {color for row in state["pixels"] for color in row}
    assert len(used_colors) <= 12
    assert used_colors.issubset(set(state["palette"]))


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
        editor_page.locator("#exportRawPixelBtn").click()
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


def test_export_menu_stays_inside_narrow_viewports(editor_page: Page) -> None:
    for width in (640, 768, 900):
        editor_page.set_viewport_size({"width": width, "height": 520})
        editor_page.locator(".btn-primary").click()
        menu = editor_page.locator("#exportDropdown")
        expect(menu).to_be_visible()
        box = menu.bounding_box()
        assert box is not None
        assert box["x"] >= 8
        assert box["x"] + box["width"] <= width - 8
        assert box["y"] >= 8
        assert box["y"] + box["height"] <= 520 - 8
        editor_page.locator(".btn-primary").click()


def test_work_share_modal_scrolls_to_all_actions_in_short_landscape(
    editor_page: Page,
) -> None:
    width = 640
    height = 320
    editor_page.set_viewport_size({"width": width, "height": height})

    editor_page.locator(".btn-primary").click()
    editor_page.locator("#publishWorkMenuBtn").click()
    modal = editor_page.locator(".work-share-modal")
    expect(modal).to_be_visible()
    editor_page.wait_for_timeout(220)

    box = modal.bounding_box()
    assert box is not None
    assert box["y"] >= 8
    assert box["y"] + box["height"] <= height - 8
    assert modal.evaluate(
        "(element) => element.scrollHeight > element.clientHeight"
    )

    load_button = editor_page.locator("#loadWorkButton")
    load_button.scroll_into_view_if_needed()
    expect(load_button).to_be_visible()
    load_box = load_button.bounding_box()
    assert load_box is not None
    assert load_box["y"] >= 0
    assert load_box["y"] + load_box["height"] <= height

    publish_button = editor_page.locator("#publishWorkButton")
    publish_button.scroll_into_view_if_needed()
    publish_button.click()
    confirm_button = editor_page.locator("#confirmPublishButton")
    confirm_button.scroll_into_view_if_needed()
    expect(confirm_button).to_be_visible()
    confirm_box = confirm_button.bounding_box()
    assert confirm_box is not None
    assert confirm_box["y"] >= 0
    assert confirm_box["y"] + confirm_box["height"] <= height


def test_author_modal_scrolls_inside_short_landscape(
    editor_page: Page,
) -> None:
    width = 568
    height = 240
    editor_page.set_viewport_size({"width": width, "height": height})
    editor_page.locator("#authorInfoBtn").click()

    modal = editor_page.locator("#authorModal .author-modal")
    expect(modal).to_be_visible()
    editor_page.wait_for_timeout(220)
    modal_box = modal.bounding_box()
    assert modal_box is not None
    assert modal_box["x"] >= 8
    assert modal_box["y"] >= 8
    assert modal_box["x"] + modal_box["width"] <= width - 8
    assert modal_box["y"] + modal_box["height"] <= height - 8
    assert modal.evaluate(
        "(element) => element.scrollHeight > element.clientHeight"
    )

    project_note = editor_page.locator(".author-project-note")
    project_note.scroll_into_view_if_needed()
    note_box = project_note.bounding_box()
    assert note_box is not None
    assert note_box["y"] >= 0
    assert note_box["y"] + note_box["height"] <= height


def test_fullscreen_button_hides_when_browser_api_is_unavailable(
    editor_page: Page,
) -> None:
    editor_page.set_viewport_size({"width": 640, "height": 360})
    editor_page.evaluate(
        """
        () => {
          Object.defineProperty(document.documentElement, 'requestFullscreen', {
            configurable: true,
            value: undefined
          });
          Object.defineProperty(
            document.documentElement,
            'webkitRequestFullscreen',
            {configurable: true, value: undefined}
          );
          syncFullscreenControl();
        }
        """
    )

    expect(editor_page.locator("#mobileFullscreenBtn")).to_be_hidden()


@pytest.mark.parametrize(
    ("width", "height"),
    (
        (568, 320),
        (740, 360),
        (844, 390),
        (915, 412),
    ),
)
def test_mobile_focus_mode_fits_common_landscape_viewports(
    editor_page: Page,
    width: int,
    height: int,
) -> None:
    editor_page.set_viewport_size({"width": width, "height": height})
    editor_page.evaluate("checkOrientation()")
    expect(editor_page.locator("#rotateHint")).to_be_hidden()
    mode_button = editor_page.locator("#mobileWorkspaceModeBtn")
    expect(mode_button).to_be_visible()
    mode_button.click()

    leading_box = editor_page.locator(".top-leading-actions").bounding_box()
    action_box = editor_page.locator(".top-bar .btn-group").bounding_box()
    center_box = editor_page.locator("#centerPanel").bounding_box()
    left_toggle_box = editor_page.locator(
        "#mobileLeftPanelBtn"
    ).bounding_box()
    right_toggle_box = editor_page.locator(
        "#mobileRightPanelBtn"
    ).bounding_box()
    assert leading_box is not None
    assert action_box is not None
    assert center_box is not None
    assert left_toggle_box is not None
    assert right_toggle_box is not None
    assert leading_box["x"] + leading_box["width"] <= action_box["x"] + 1
    assert action_box["x"] + action_box["width"] <= width + 1
    assert center_box["x"] >= 0
    assert center_box["x"] + center_box["width"] <= width + 1
    assert left_toggle_box["x"] >= 0
    assert right_toggle_box["x"] + right_toggle_box["width"] <= width + 1


def test_mobile_portrait_hint_covers_extended_phone_breakpoint(
    editor_page: Page,
) -> None:
    editor_page.set_viewport_size({"width": 915, "height": 1024})
    editor_page.evaluate("checkOrientation()")
    expect(editor_page.locator("#rotateHint")).to_be_visible()

    editor_page.set_viewport_size({"width": 915, "height": 412})
    editor_page.evaluate("checkOrientation()")
    expect(editor_page.locator("#rotateHint")).to_be_hidden()


def test_second_touch_rolls_back_unconfirmed_paint_stroke(
    editor_page: Page,
) -> None:
    select_color(editor_page, BLACK)
    canvas = editor_page.locator("#pixelCanvas")
    box = canvas.bounding_box()
    assert box is not None
    cell_width = box["width"] / 24
    cell_height = box["height"] / 24
    first = {
        "identifier": 1,
        "clientX": box["x"] + 1.5 * cell_width,
        "clientY": box["y"] + 1.5 * cell_height,
        "target": canvas.element_handle(),
    }
    moved = {
        **first,
        "clientX": box["x"] + 2.5 * cell_width,
    }
    second = {
        "identifier": 2,
        "clientX": box["x"] + 5.5 * cell_width,
        "clientY": box["y"] + 5.5 * cell_height,
        "target": canvas.element_handle(),
    }
    initial_undo_depth = editor_state(editor_page)["undoDepth"]

    canvas.dispatch_event(
        "touchstart",
        {"touches": [first], "changedTouches": [first]},
    )
    canvas.dispatch_event(
        "touchmove",
        {"touches": [moved], "changedTouches": [moved]},
    )
    painted = editor_state(editor_page)
    assert painted["pixels"][1][1] == BLACK
    assert painted["pixels"][1][2] == BLACK

    canvas.dispatch_event(
        "touchstart",
        {
            "touches": [moved, second],
            "changedTouches": [second],
        },
    )
    rolled_back = editor_state(editor_page)
    assert rolled_back["pixels"][1][1] == WHITE
    assert rolled_back["pixels"][1][2] == WHITE
    assert rolled_back["undoDepth"] == initial_undo_depth

    canvas.dispatch_event(
        "touchend",
        {"touches": [], "changedTouches": [moved, second]},
    )


def test_mobile_focus_mode_drawers_and_toolbar_gestures(
    editor_page: Page,
) -> None:
    width = 640
    height = 360
    editor_page.set_viewport_size({"width": width, "height": height})
    body = editor_page.locator("body")
    mode_button = editor_page.locator("#mobileWorkspaceModeBtn")
    left_panel = editor_page.locator("#leftPanel")
    nav_preview = editor_page.locator("#navPreviewWrap")
    left_controls = editor_page.locator("#leftPanel .left-controls")
    zoom_controls = editor_page.locator("#zoomSliderWrap")
    right_panel = editor_page.locator("#rightPanel")
    editorial_label = editor_page.locator("#rightPanel .editorial-area-label")
    first_tool_button = editor_page.locator("#rightPanel .tool-icon-btn").first
    palette_tab = editor_page.locator("#coloringTab")
    replacement_tab = editor_page.locator("#replacementTab")
    statistics_tab = editor_page.locator("#replicationTab")
    statistics_scroll = editor_page.locator("#replicationColorScroll")
    center_panel = editor_page.locator("#centerPanel")
    top_bar = editor_page.locator(".top-bar")
    toolbar_collapse_button = editor_page.locator(
        "#mobileToolbarCollapseBtn"
    )
    toolbar_handle = editor_page.locator("#mobileToolbarHandle")
    left_toggle = editor_page.locator("#mobileLeftPanelBtn")
    right_toggle = editor_page.locator("#mobileRightPanelBtn")

    expect(mode_button).to_be_visible()
    expect(body).not_to_have_class(re.compile(r"\bmobile-focus-mode\b"))
    original_center_box = center_panel.bounding_box()
    assert original_center_box is not None

    select_color(editor_page, BLACK)
    mode_button.click()
    expect(body).to_have_class(re.compile(r"\bmobile-focus-mode\b"))
    expect(mode_button).to_have_attribute("aria-pressed", "true")
    expect(toolbar_collapse_button).to_be_visible()
    expect(toolbar_handle).to_be_hidden()
    focus_center_box = center_panel.bounding_box()
    assert focus_center_box is not None
    assert focus_center_box["width"] > original_center_box["width"]
    assert focus_center_box["width"] == pytest.approx(width, abs=1)

    left_toggle.click()
    expect(body).to_have_class(re.compile(r"\bmobile-left-drawer-open\b"))
    expect(left_toggle).to_have_attribute("aria-expanded", "true")
    editor_page.wait_for_timeout(220)
    left_box = left_panel.bounding_box()
    left_center_box = center_panel.bounding_box()
    left_toggle_box = left_toggle.bounding_box()
    assert left_box is not None
    assert left_center_box is not None
    assert left_toggle_box is not None
    assert left_box["x"] >= 0
    assert left_center_box["x"] == pytest.approx(
        left_box["x"] + left_box["width"], abs=1
    )
    assert left_center_box["width"] == pytest.approx(
        width - left_box["width"], abs=1
    )
    assert left_toggle_box["x"] == (
        pytest.approx(left_center_box["x"], abs=1)
    )
    preview_box = nav_preview.bounding_box()
    controls_box = left_controls.bounding_box()
    zoom_box = zoom_controls.bounding_box()
    assert preview_box is not None
    assert controls_box is not None
    assert zoom_box is not None
    assert preview_box["width"] == pytest.approx(preview_box["height"], abs=1)
    assert preview_box["x"] + preview_box["width"] <= controls_box["x"] + 1
    assert preview_box["y"] + preview_box["height"] <= (
        left_box["y"] + left_box["height"] + 1
    )
    assert controls_box["y"] + controls_box["height"] <= (
        left_box["y"] + left_box["height"] + 1
    )
    assert zoom_box["y"] + zoom_box["height"] <= (
        left_box["y"] + left_box["height"] + 1
    )
    click_canvas_cell(editor_page, 1, 1)
    assert editor_state(editor_page)["pixels"][1][1] == BLACK
    expect(body).to_have_class(re.compile(r"\bmobile-left-drawer-open\b"))

    right_toggle.click()
    expect(body).not_to_have_class(
        re.compile(r"\bmobile-left-drawer-open\b")
    )
    expect(body).to_have_class(re.compile(r"\bmobile-right-drawer-open\b"))
    editor_page.wait_for_timeout(220)
    right_box = right_panel.bounding_box()
    right_center_box = center_panel.bounding_box()
    right_toggle_box = right_toggle.bounding_box()
    assert right_box is not None
    assert right_center_box is not None
    assert right_toggle_box is not None
    assert right_box["x"] + right_box["width"] <= width + 1
    assert right_center_box["x"] == pytest.approx(0, abs=1)
    assert right_center_box["width"] == pytest.approx(
        width - right_box["width"], abs=1
    )
    assert right_center_box["x"] + right_center_box["width"] == (
        pytest.approx(right_box["x"], abs=1)
    )
    assert right_toggle_box["x"] + right_toggle_box["width"] == (
        pytest.approx(right_box["x"], abs=1)
    )
    select_color(editor_page, RED)
    click_canvas_cell(editor_page, 2, 2)
    assert editor_state(editor_page)["pixels"][2][2] == RED
    expect(body).to_have_class(re.compile(r"\bmobile-right-drawer-open\b"))
    expect(editorial_label).to_be_hidden()
    tool_button_box = first_tool_button.bounding_box()
    palette_tab_box = palette_tab.bounding_box()
    assert tool_button_box is not None
    assert palette_tab_box is not None
    assert tool_button_box["height"] <= 37
    assert palette_tab_box["height"] <= 37

    replacement_tab.click()
    expect(editor_page.locator("#replacementHint")).to_be_hidden()
    editor_page.locator(
        f'.color-statistics-color[data-color="{BLACK}"]'
    ).click()
    replacement_actions_box = editor_page.locator(
        "#replacementPrimaryActions"
    ).bounding_box()
    related_button_box = editor_page.locator(
        "#replacementRelatedBtn"
    ).bounding_box()
    replacement_button_box = editor_page.locator(
        "#replacementStartBtn"
    ).bounding_box()
    assert replacement_actions_box is not None
    assert related_button_box is not None
    assert replacement_button_box is not None
    assert related_button_box["height"] == pytest.approx(
        replacement_button_box["height"], abs=1
    )
    assert related_button_box["x"] >= replacement_actions_box["x"] - 1
    assert (
        replacement_button_box["x"] + replacement_button_box["width"]
        <= replacement_actions_box["x"] +
        replacement_actions_box["width"] + 1
    )

    statistics_tab.click()
    expect(statistics_scroll).to_be_visible()
    statistics_scroll_box = statistics_scroll.bounding_box()
    black_stat = editor_page.locator(
        f'.statistics-color[data-color="{BLACK}"]'
    )
    black_stat_box = black_stat.bounding_box()
    assert statistics_scroll_box is not None
    assert black_stat_box is not None
    assert statistics_scroll_box["height"] >= 72
    assert black_stat_box["y"] >= statistics_scroll_box["y"] - 1
    assert black_stat_box["y"] + black_stat_box["height"] <= (
        statistics_scroll_box["y"] + statistics_scroll_box["height"] + 1
    )
    black_stat.click()
    assert editor_state(editor_page)["replicationHighlightColor"] == BLACK

    right_toggle.click()
    expect(body).not_to_have_class(re.compile(r"\bmobile-right-drawer-open\b"))
    expect(right_toggle).to_have_attribute("aria-expanded", "false")
    editor_page.wait_for_timeout(220)
    restored_center_box = center_panel.bounding_box()
    assert restored_center_box is not None
    assert restored_center_box["width"] == pytest.approx(width, abs=1)

    expanded_top_height = top_bar.bounding_box()["height"]
    toolbar_collapse_button.click()
    expect(body).to_have_class(re.compile(r"\bmobile-toolbar-collapsed\b"))
    editor_page.wait_for_timeout(220)
    collapsed_top_height = top_bar.bounding_box()["height"]
    assert collapsed_top_height < expanded_top_height
    assert collapsed_top_height <= 1
    expect(toolbar_handle).to_be_visible()
    collapsed_editor_body_box = editor_page.locator(
        ".editor-body"
    ).bounding_box()
    collapsed_center_box = center_panel.bounding_box()
    assert collapsed_editor_body_box is not None
    assert collapsed_center_box is not None
    assert collapsed_center_box["y"] == pytest.approx(
        collapsed_editor_body_box["y"], abs=1
    )

    initial_handle_box = toolbar_handle.bounding_box()
    assert initial_handle_box is not None
    initial_handle_center = (
        initial_handle_box["x"] + initial_handle_box["width"] / 2
    )
    assert initial_handle_center == pytest.approx(width / 2, abs=2)
    drag_y = initial_handle_box["y"] + initial_handle_box["height"] / 2
    drag_delta = (
        120
        if initial_handle_center < width / 2
        else -120
    )
    editor_page.mouse.move(initial_handle_center, drag_y)
    editor_page.mouse.down()
    editor_page.mouse.move(
        initial_handle_center + drag_delta,
        drag_y,
        steps=4,
    )
    editor_page.mouse.up()
    expect(body).to_have_class(re.compile(r"\bmobile-toolbar-collapsed\b"))
    dragged_handle_box = toolbar_handle.bounding_box()
    assert dragged_handle_box is not None
    assert abs(dragged_handle_box["x"] - initial_handle_box["x"]) > 60
    assert dragged_handle_box["x"] >= collapsed_center_box["x"] + 5
    assert (
        dragged_handle_box["x"] + dragged_handle_box["width"]
        <= collapsed_center_box["x"] + collapsed_center_box["width"] - 5
    )

    toolbar_handle.click()
    expect(body).not_to_have_class(
        re.compile(r"\bmobile-toolbar-collapsed\b")
    )
    expect(toolbar_collapse_button).to_be_visible()

    center_box = center_panel.bounding_box()
    assert center_box is not None
    gesture_x = center_box["x"] + 4
    gesture_start_y = center_box["y"] + center_box["height"] - 8
    editor_page.dispatch_event(
        "#canvasContainer",
        "pointerdown",
        {
            "pointerId": 41,
            "pointerType": "touch",
            "button": 0,
            "clientX": gesture_x,
            "clientY": gesture_start_y,
            "bubbles": True,
        },
    )
    editor_page.dispatch_event(
        "#canvasContainer",
        "pointermove",
        {
            "pointerId": 41,
            "pointerType": "touch",
            "button": 0,
            "clientX": gesture_x,
            "clientY": gesture_start_y - 60,
            "bubbles": True,
        },
    )
    editor_page.dispatch_event(
        "#canvasContainer",
        "pointerup",
        {
            "pointerId": 41,
            "pointerType": "touch",
            "button": 0,
            "clientX": gesture_x,
            "clientY": gesture_start_y - 60,
            "bubbles": True,
        },
    )
    expect(body).to_have_class(re.compile(r"\bmobile-toolbar-collapsed\b"))

    collapsed_center_box = center_panel.bounding_box()
    assert collapsed_center_box is not None
    restore_x = collapsed_center_box["x"] + 4
    restore_start_y = collapsed_center_box["y"] + 8
    editor_page.dispatch_event(
        "#centerPanel",
        "pointerdown",
        {
            "pointerId": 42,
            "pointerType": "touch",
            "button": 0,
            "clientX": restore_x,
            "clientY": restore_start_y,
        },
    )
    editor_page.dispatch_event(
        "#centerPanel",
        "pointermove",
        {
            "pointerId": 42,
            "pointerType": "touch",
            "button": 0,
            "clientX": restore_x,
            "clientY": restore_start_y + 60,
        },
    )
    editor_page.dispatch_event(
        "#centerPanel",
        "pointerup",
        {
            "pointerId": 42,
            "pointerType": "touch",
            "button": 0,
            "clientX": restore_x,
            "clientY": restore_start_y + 60,
        },
    )
    expect(body).not_to_have_class(
        re.compile(r"\bmobile-toolbar-collapsed\b")
    )
    mode_button.click()
    expect(body).not_to_have_class(re.compile(r"\bmobile-focus-mode\b"))
    expect(body).not_to_have_class(
        re.compile(r"\bmobile-toolbar-collapsed\b")
    )
    expect(mode_button).to_have_attribute("aria-pressed", "false")


def test_mobile_reference_overlay_remains_visible_in_replication_mode(
    editor_page: Page,
) -> None:
    editor_page.set_viewport_size({"width": 640, "height": 360})
    import_image(
        editor_page,
        FIXTURES / "avatar-reference-synthetic.png",
    )

    editor_page.locator("#mobileWorkspaceModeBtn").click()
    editor_page.locator("#mobileRightPanelBtn").click()
    editor_page.locator("#replicationTab").click()
    editor_page.locator(".statistics-color").first.click()
    expect(editor_page.locator("#statisticsOverlayCanvas")).to_be_visible()
    editor_page.locator("#mobileLeftPanelBtn").click()
    editor_page.locator("#overlayToggleBtn").click()

    expect(editor_page.locator("#overlayCanvas")).to_be_visible()
    expect(editor_page.locator("#statisticsOverlayCanvas")).to_be_visible()
    overlay_alpha = editor_page.locator("#overlayCanvas").evaluate(
        """canvas => canvas.getContext('2d').getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1
        ).data[3]"""
    )
    assert overlay_alpha > 0

    editor_page.locator("#overlayOpacity").fill("70")
    assert editor_state(editor_page)["overlayOpacity"] == pytest.approx(0.7)
    adjusted_alpha = editor_page.locator("#overlayCanvas").evaluate(
        """canvas => canvas.getContext('2d').getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1
        ).data[3]"""
    )
    assert adjusted_alpha > overlay_alpha

    editor_page.locator("#mobileRightPanelBtn").click()
    editor_page.locator("#coloringTab").click()
    expect(editor_page.locator("#statisticsOverlayCanvas")).to_be_hidden()
    expect(editor_page.locator("#overlayCanvas")).to_be_visible()


def test_mobile_landscape_crop_keeps_large_image_zoom_and_actions_visible(
    editor_page: Page,
    tmp_path: Path,
) -> None:
    width = 640
    height = 360
    editor_page.set_viewport_size({"width": width, "height": height})
    editor_page.locator("#importFileInput").set_input_files(
        str(FIXTURES / "large-pattern.png")
    )

    overlay = editor_page.locator("#cropOverlay")
    viewport = editor_page.locator("#cropViewport")
    options = editor_page.locator(".crop-options")
    note = editor_page.locator("#conversionNote")
    buttons = editor_page.locator(".crop-btns")
    slider = editor_page.locator("#cropZoomSlider")
    expect(overlay).to_be_visible()
    editor_page.wait_for_function(
        "() => Number(document.querySelector('#cropZoomSlider').value) < 10"
    )

    zoom_range = slider.evaluate(
        "slider => ({min: Number(slider.min), value: Number(slider.value)})"
    )
    assert 1 <= zoom_range["value"] < 10
    assert zoom_range["min"] == zoom_range["value"]

    viewport_box = viewport.bounding_box()
    options_box = options.bounding_box()
    note_box = note.bounding_box()
    buttons_box = buttons.bounding_box()
    assert viewport_box is not None
    assert options_box is not None
    assert note_box is not None
    assert buttons_box is not None
    assert viewport_box["width"] >= 190
    assert viewport_box["x"] + viewport_box["width"] < options_box["x"]
    for box in (viewport_box, options_box, note_box, buttons_box):
        assert box["x"] >= 0
        assert box["y"] >= 0
        assert box["x"] + box["width"] <= width + 1
        assert box["y"] + box["height"] <= height + 1

    slider.evaluate(
        """slider => {
          slider.value = String(Number(slider.min) + 1);
          slider.dispatchEvent(new Event('input', {bubbles: true}));
        }"""
    )
    assert int(slider.input_value()) == zoom_range["min"] + 1
    slider.evaluate(
        """slider => {
          slider.value = slider.min;
          slider.dispatchEvent(new Event('input', {bubbles: true}));
        }"""
    )
    assert int(slider.input_value()) == zoom_range["min"]
    expect(editor_page.locator("#cropZoomVal")).to_have_text(
        f"{zoom_range['min']}%"
    )

    editor_page.evaluate(
        "() => setConversionStatus('正在准备本地转换…', false, false)"
    )
    status_box = editor_page.locator("#conversionStatus").bounding_box()
    busy_viewport_box = viewport.bounding_box()
    busy_buttons_box = buttons.bounding_box()
    assert status_box is not None
    assert busy_viewport_box is not None
    assert busy_buttons_box is not None
    assert busy_viewport_box["width"] == pytest.approx(
        viewport_box["width"], abs=1
    )
    assert status_box["y"] + status_box["height"] <= height + 1
    assert busy_buttons_box["y"] + busy_buttons_box["height"] <= height + 1

    editor_page.locator("#cancelCropBtn").click()
    tiny_image = tmp_path / "tiny-source.png"
    Image.new("RGB", (8, 8), "#D42F37").save(tiny_image)
    editor_page.locator("#importFileInput").set_input_files(str(tiny_image))
    expect(overlay).to_be_visible()
    editor_page.wait_for_function(
        "() => Number(document.querySelector('#cropZoomSlider').value) > 500"
    )
    tiny_zoom_range = slider.evaluate(
        "slider => ({max: Number(slider.max), value: Number(slider.value)})"
    )
    assert tiny_zoom_range["value"] > 500
    assert tiny_zoom_range["max"] == tiny_zoom_range["value"] * 2
    slider.evaluate(
        """slider => {
          slider.value = slider.max;
          slider.dispatchEvent(new Event('input', {bubbles: true}));
        }"""
    )
    assert int(slider.input_value()) == tiny_zoom_range["max"]


def test_shared_work_publish_and_load_round_trip(editor_page: Page) -> None:
    code = "7Kp3mXqB4NzR"
    black_palette_index = 0
    packed_black_group = bytes(
        [
            (black_palette_index << 2) | (black_palette_index >> 4),
            ((black_palette_index & 0x0F) << 4) | (black_palette_index >> 2),
            ((black_palette_index & 0x03) << 6) | black_palette_index,
        ]
    )
    all_black_payload = base64.b64encode(
        packed_black_group * (24 * 24 // 4)
    ).decode("ascii")
    published_payload: dict[str, object] = {}

    def handle_publish(route) -> None:
        published_payload.update(route.request.post_data_json)
        route.fulfill(
            status=201,
            content_type="application/json",
            body=(
                '{"code":"' + code + '","schemaVersion":1,'
                '"paletteId":"natural-64-v2","paletteVersion":2,'
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
                '"paletteId":"natural-64-v2","paletteVersion":2,'
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
    expect(editor_page.locator("#publishConfirmation")).to_be_visible()
    expect(editor_page.locator("#publishConfirmationTitle")).to_have_text(
        "很糊的画"
    )
    expect(editor_page.locator("#publishConfirmationAuthor")).to_have_text(
        "博士"
    )
    assert published_payload == {}
    editor_page.locator("#cancelPublishConfirmationButton").click()
    expect(editor_page.locator("#publishConfirmation")).to_be_hidden()
    expect(editor_page.locator("#workTitleInput")).to_be_visible()
    editor_page.locator("#publishWorkButton").click()
    editor_page.locator("#confirmPublishButton").click()
    expect(editor_page.locator("#publishedWorkCode")).to_have_text(code)
    editor_page.context.grant_permissions(
        ["clipboard-read", "clipboard-write"],
        origin=editor_page.evaluate("location.origin"),
    )
    editor_page.locator("#publishedWorkCode").click()
    assert editor_page.evaluate("navigator.clipboard.readText()") == code
    share_link = editor_page.locator("#publishedWorkLink").text_content()
    assert share_link is not None
    assert share_link.startswith("博士向你分享了《很糊的画》：")
    assert share_link.endswith("/?work=" + code)
    editor_page.locator("#publishedWorkLink").click()
    assert editor_page.evaluate("navigator.clipboard.readText()") == share_link

    assert published_payload["schemaVersion"] == 1
    assert published_payload["paletteId"] == "natural-64-v2"
    assert published_payload["paletteVersion"] == 2
    assert published_payload["title"] == "很糊的画"
    assert published_payload["authorName"] == "博士"
    encoded = str(published_payload["pixels"])
    assert len(encoded) == 576
    assert len(base64.b64decode(encoded)) == 432

    editor_page.locator("#workCodeInput").fill(share_link + "A")
    editor_page.locator("#loadWorkButton").click()
    expect(editor_page.locator("#workShareStatus")).to_contain_text(
        "有效的12位Base58"
    )
    editor_page.locator("#workCodeInput").fill(share_link)
    editor_page.locator("#loadWorkButton").click()
    expect(editor_page.locator("#readReplaceConfirmation")).to_be_visible()
    editor_page.locator("#checkpointAndLoadButton").click()
    expect(editor_page.locator("#toast")).to_contain_text(
        "已读取《很糊的画》 · 作者：博士"
    )
    expect(editor_page.locator("#workShareModal")).to_be_hidden()
    loaded = editor_state(editor_page)
    assert all(color == BLACK for row in loaded["pixels"] for color in row)
    expect(editor_page.locator("#topWorkTitle")).to_have_text("《很糊的画》")
    expect(editor_page.locator("#topWorkMeta")).to_contain_text("作者：博士")
    expect(editor_page.locator("#topWorkMeta")).to_contain_text("浏览次数：1")
    expect(editor_page.locator("#topWorkMeta")).to_contain_text(code)
    expect(editor_page.locator("#saveStatus")).to_contain_text(
        "有手动保存点"
    )

    select_color(editor_page, RED)
    paint_cells(editor_page, [(0, 0)])
    expect(editor_page.locator("#topWorkTitle")).to_have_text(
        "旅行「像」框 | 24×24 像素画编辑器"
    )
    expect(editor_page.locator("#topWorkMeta")).to_be_hidden()

    editor_page.locator("#undoBtn").click()
    wait_for_history(editor_page)
    expect(editor_page.locator("#topWorkTitle")).to_have_text("《很糊的画》")

    editor_page.locator("#undoBtn").click()
    wait_for_history(editor_page)
    assert pixel_signature(editor_state(editor_page)) == before_load
    expect(editor_page.locator("#topWorkTitle")).to_have_text(
        "旅行「像」框 | 24×24 像素画编辑器"
    )
