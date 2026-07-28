from __future__ import annotations

from pathlib import Path
from typing import Any

from playwright.sync_api import Page, expect


def editor_state(page: Page) -> dict[str, Any]:
    return page.evaluate("() => window.__TOURGRID_TEST__.getState()")


def pixel_signature(state: dict[str, Any]) -> tuple[tuple[str, ...], ...]:
    return tuple(tuple(row) for row in state["pixels"])


def select_color(page: Page, color: str) -> None:
    page.locator(f'.color-swatch[data-color="{color}"]').click()


def click_canvas_cell(page: Page, x: int, y: int) -> None:
    canvas = page.locator("#pixelCanvas")
    box = canvas.bounding_box()
    assert box is not None
    page.mouse.click(
        box["x"] + (x + 0.5) * box["width"] / 24,
        box["y"] + (y + 0.5) * box["height"] / 24,
    )


def paint_cells(
    page: Page,
    cells: list[tuple[int, int]],
) -> None:
    if not cells:
        return
    canvas = page.locator("#pixelCanvas")
    box = canvas.bounding_box()
    assert box is not None
    cell_width = box["width"] / 24
    cell_height = box["height"] / 24

    def point(cell: tuple[int, int]) -> tuple[float, float]:
        x, y = cell
        return (
            box["x"] + (x + 0.5) * cell_width,
            box["y"] + (y + 0.5) * cell_height,
        )

    start_x, start_y = point(cells[0])
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    for cell in cells[1:]:
        x, y = point(cell)
        page.mouse.move(x, y, steps=4)
    page.mouse.up()


def import_image(page: Page, image_path: Path) -> dict[str, Any]:
    page.locator("#importFileInput").set_input_files(str(image_path))
    expect(page.locator("#cropOverlay")).to_be_visible()
    page.locator("#confirmCropBtn").click()
    expect(page.locator("#cropOverlay")).to_be_hidden(timeout=15_000)
    page.wait_for_function(
        "() => !window.__TOURGRID_TEST__.getState().conversionInProgress"
    )
    state = editor_state(page)
    assert state["referenceLoaded"] is True
    return state


def wait_for_history(page: Page) -> None:
    page.wait_for_function(
        "() => !window.__TOURGRID_TEST__.getState()"
        ".historyOperationInProgress"
    )


def clear_canvas(page: Page) -> None:
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator(".btn-delete").click()
