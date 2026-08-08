"""Backend package for Tourgrid Studio."""

from .palette import DEFAULT_PALETTE_ID, PaletteDefinition, load_palette

APP_VERSION = "0.3.2"

__all__ = [
    "APP_VERSION",
    "DEFAULT_PALETTE_ID",
    "PaletteDefinition",
    "load_palette",
]
