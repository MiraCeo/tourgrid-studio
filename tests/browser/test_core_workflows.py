from __future__ import annotations

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
