from __future__ import annotations

import argparse
import os
from dataclasses import dataclass

import psycopg

from backend.api.work_store import canonical_content_digest
from backend.palette import PaletteDefinition, load_palette


SOURCE_PALETTE_ID = "natural-64-v2"
SOURCE_PALETTE_VERSION = 2
TARGET_PALETTE_ID = "official-40-v1"
TARGET_PALETTE_VERSION = 1
PACKED_PIXEL_BYTES = 432


@dataclass(frozen=True)
class WorkConversion:
    code: str
    schema_version: int
    pixel_data: bytes
    content_hash: bytes


def weighted_rgb_distance(
    source: tuple[int, int, int],
    target: tuple[int, int, int],
) -> int:
    dr = source[0] - target[0]
    dg = source[1] - target[1]
    db = source[2] - target[2]
    return 2 * dr * dr + 4 * dg * dg + 3 * db * db


def build_index_mapping(
    source: PaletteDefinition,
    target: PaletteDefinition,
) -> tuple[int, ...]:
    if len(source.colors) != 64:
        raise ValueError("Source palette must contain exactly 64 colors")
    if len(target.colors) != 40:
        raise ValueError("Target palette must contain exactly 40 colors")

    mapping: list[int] = []
    for source_color in source.colors:
        target_index = min(
            range(len(target.colors)),
            key=lambda index: (
                weighted_rgb_distance(
                    source_color.rgb,
                    target.colors[index].rgb,
                ),
                index,
            ),
        )
        mapping.append(target_index)
    return tuple(mapping)


def unpack_indices(payload: bytes) -> list[int]:
    if len(payload) != PACKED_PIXEL_BYTES:
        raise ValueError("Packed work must contain exactly 432 bytes")
    indices: list[int] = []
    for offset in range(0, len(payload), 3):
        value = int.from_bytes(payload[offset : offset + 3], "big")
        indices.extend(
            (
                (value >> 18) & 0x3F,
                (value >> 12) & 0x3F,
                (value >> 6) & 0x3F,
                value & 0x3F,
            )
        )
    return indices


def pack_indices(indices: list[int]) -> bytes:
    if len(indices) != 24 * 24:
        raise ValueError("A work must contain exactly 576 pixel indices")
    output = bytearray()
    for offset in range(0, len(indices), 4):
        group = indices[offset : offset + 4]
        if any(index < 0 or index > 0x3F for index in group):
            raise ValueError("Pixel index does not fit in 6 bits")
        value = (
            (group[0] << 18)
            | (group[1] << 12)
            | (group[2] << 6)
            | group[3]
        )
        output.extend(value.to_bytes(3, "big"))
    return bytes(output)


def convert_pixels(payload: bytes, mapping: tuple[int, ...]) -> bytes:
    source_indices = unpack_indices(payload)
    try:
        target_indices = [mapping[index] for index in source_indices]
    except IndexError as error:
        raise ValueError("Work contains an index outside the source palette") from error
    return pack_indices(target_indices)


def _load_conversions(
    connection: psycopg.Connection[tuple],
    mapping: tuple[int, ...],
) -> tuple[list[WorkConversion], int]:
    rows = connection.execute(
        """
        SELECT code, schema_version, pixel_data
        FROM works
        WHERE palette_id = %s
          AND palette_version = %s
          AND pixel_data IS NOT NULL
        ORDER BY id
        FOR UPDATE
        """,
        (SOURCE_PALETTE_ID, SOURCE_PALETTE_VERSION),
    ).fetchall()
    conversions: list[WorkConversion] = []
    for code, schema_version, source_pixels in rows:
        target_pixels = convert_pixels(bytes(source_pixels), mapping)
        target_hash = canonical_content_digest(
            schema_version=schema_version,
            palette_id=TARGET_PALETTE_ID,
            palette_version=TARGET_PALETTE_VERSION,
            pixel_data=target_pixels,
        )
        conversions.append(
            WorkConversion(
                code=code,
                schema_version=schema_version,
                pixel_data=target_pixels,
                content_hash=target_hash,
            )
        )
    purged_count = connection.execute(
        """
        SELECT COUNT(*)
        FROM works
        WHERE palette_id = %s
          AND palette_version = %s
          AND pixel_data IS NULL
        """,
        (SOURCE_PALETTE_ID, SOURCE_PALETTE_VERSION),
    ).fetchone()[0]
    return conversions, purged_count


def _assert_no_collisions(
    connection: psycopg.Connection[tuple],
    conversions: list[WorkConversion],
) -> None:
    code_by_hash: dict[bytes, str] = {}
    collisions: list[str] = []
    for conversion in conversions:
        owner = code_by_hash.get(conversion.content_hash)
        if owner is not None and owner != conversion.code:
            collisions.append(f"{owner} <-> {conversion.code}")
        code_by_hash[conversion.content_hash] = conversion.code

    for conversion in conversions:
        existing = connection.execute(
            "SELECT code FROM works WHERE content_hash = %s",
            (conversion.content_hash,),
        ).fetchone()
        if existing is not None and existing[0] != conversion.code:
            collisions.append(f"work {conversion.code} -> existing {existing[0]}")
        tombstone = connection.execute(
            """
            SELECT code
            FROM work_tombstones
            WHERE canonical_content_hash = %s
            """,
            (conversion.content_hash,),
        ).fetchone()
        if tombstone is not None and tombstone[0] != conversion.code:
            collisions.append(
                f"work {conversion.code} -> tombstone {tombstone[0]}"
            )

    if collisions:
        details = ", ".join(sorted(set(collisions)))
        raise RuntimeError(
            "Migration would merge distinct share codes; no rows changed: "
            + details
        )


def migrate(database_url: str, *, apply: bool) -> None:
    source = load_palette(SOURCE_PALETTE_ID)
    target = load_palette(TARGET_PALETTE_ID)
    mapping = build_index_mapping(source, target)

    with psycopg.connect(database_url) as connection:
        with connection.transaction():
            if apply:
                connection.execute(
                    "LOCK TABLE works IN SHARE ROW EXCLUSIVE MODE"
                )
                connection.execute(
                    "LOCK TABLE work_tombstones IN SHARE ROW EXCLUSIVE MODE"
                )
            conversions, purged_count = _load_conversions(connection, mapping)
            _assert_no_collisions(connection, conversions)

            print(
                f"Convertible works: {len(conversions)}; "
                f"purged legacy rows left unchanged: {purged_count}"
            )
            if not apply:
                print("Dry run only. Re-run with --apply after taking a pg_dump backup.")
                return

            for conversion in conversions:
                connection.execute(
                    """
                    UPDATE works
                    SET palette_id = %s,
                        palette_version = %s,
                        pixel_data = %s,
                        content_hash = %s
                    WHERE code = %s
                    """,
                    (
                        TARGET_PALETTE_ID,
                        TARGET_PALETTE_VERSION,
                        conversion.pixel_data,
                        conversion.content_hash,
                        conversion.code,
                    ),
                )
                connection.execute(
                    """
                    UPDATE work_tombstones
                    SET canonical_content_hash = %s,
                        palette_id = %s,
                        palette_version = %s
                    WHERE code = %s
                    """,
                    (
                        conversion.content_hash,
                        TARGET_PALETTE_ID,
                        TARGET_PALETTE_VERSION,
                        conversion.code,
                    ),
                )
            print(f"Migrated {len(conversions)} works to {TARGET_PALETTE_ID}.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Map natural-64-v2 work pixels to official-40-v1. "
            "Runs as a dry-run unless --apply is supplied."
        )
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="commit the migration after collision checks",
    )
    arguments = parser.parse_args()
    database_url = os.getenv("TOURGRID_DATABASE_URL")
    if not database_url:
        parser.error("TOURGRID_DATABASE_URL is required")
    migrate(database_url, apply=arguments.apply)


if __name__ == "__main__":
    main()
