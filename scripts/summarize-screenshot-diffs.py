#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Summarize Playwright screenshot diffs from a test-results directory (BUILD-003D §3.16).

Prints, for every ``*-diff.png``: image size, the count of differing pixels
(Playwright draws them pure red), the count of anti-aliased pixels (pure
yellow), up to eight bounding boxes of differing regions, and the SHA-256 of
the expected, actual and diff images. It never uploads anything and never
changes a result; it only makes a failure diagnosable from the log.

Usage: summarize-screenshot-diffs.py <test-results-dir>
       summarize-screenshot-diffs.py --self-test
"""
from __future__ import annotations

import hashlib
import struct
import sys
import zlib
from pathlib import Path

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
RED = (255, 0, 0)
YELLOW = (255, 255, 0)
CELL = 16
MAX_BOXES = 8
MAX_BYTES = 64 * 1024 * 1024


def decode_png(data: bytes) -> tuple[int, int, list[bytes]]:
    """Decode an 8-bit RGB or RGBA non-interlaced PNG into rows of RGBA bytes."""
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG file")
    offset = len(PNG_SIGNATURE)
    width = height = color_type = None
    compressed = bytearray()
    while offset < len(data):
        (length,) = struct.unpack(">I", data[offset:offset + 4])
        kind = data[offset + 4:offset + 8]
        body = data[offset + 8:offset + 8 + length]
        offset += 12 + length
        if kind == b"IHDR":
            width, height, depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", body)
            if depth != 8 or color_type not in (2, 6) or interlace != 0:
                raise ValueError("unsupported PNG layout")
        elif kind == b"IDAT":
            compressed += body
        elif kind == b"IEND":
            break
    if width is None or height is None or color_type is None:
        raise ValueError("missing IHDR")
    channels = 4 if color_type == 6 else 3
    raw = zlib.decompress(bytes(compressed))
    stride = width * channels
    rows: list[bytes] = []
    previous = bytearray(stride)
    position = 0
    for _ in range(height):
        filter_type = raw[position]
        line = bytearray(raw[position + 1:position + 1 + stride])
        position += 1 + stride
        for i in range(stride):
            left = line[i - channels] if i >= channels else 0
            up = previous[i]
            upper_left = previous[i - channels] if i >= channels else 0
            if filter_type == 1:
                line[i] = (line[i] + left) & 0xFF
            elif filter_type == 2:
                line[i] = (line[i] + up) & 0xFF
            elif filter_type == 3:
                line[i] = (line[i] + ((left + up) >> 1)) & 0xFF
            elif filter_type == 4:
                estimate = left + up - upper_left
                pa, pb, pc = abs(estimate - left), abs(estimate - up), abs(estimate - upper_left)
                predictor = left if pa <= pb and pa <= pc else (up if pb <= pc else upper_left)
                line[i] = (line[i] + predictor) & 0xFF
            elif filter_type != 0:
                raise ValueError("unknown PNG filter")
        previous = line
        if channels == 3:
            rgba = bytearray()
            for i in range(0, stride, 3):
                rgba += line[i:i + 3] + b"\xff"
            rows.append(bytes(rgba))
        else:
            rows.append(bytes(line))
    return width, height, rows


def summarize(width: int, height: int, rows: list[bytes]) -> dict:
    differing = anti_aliased = 0
    cells: dict[tuple[int, int], list[int]] = {}
    for y, row in enumerate(rows):
        for x in range(width):
            r, g, b = row[4 * x], row[4 * x + 1], row[4 * x + 2]
            if (r, g, b) == RED:
                differing += 1
                key = (x // CELL, y // CELL)
                box = cells.setdefault(key, [x, y, x, y])
                box[0], box[1] = min(box[0], x), min(box[1], y)
                box[2], box[3] = max(box[2], x), max(box[3], y)
            elif (r, g, b) == YELLOW:
                anti_aliased += 1
    # Group adjacent 16-pixel cells (8-connectivity) into regions.
    regions = []
    seen: set[tuple[int, int]] = set()
    for start in sorted(cells):
        if start in seen:
            continue
        stack, members = [start], []
        seen.add(start)
        while stack:
            cx, cy = stack.pop()
            members.append((cx, cy))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    neighbour = (cx + dx, cy + dy)
                    if neighbour in cells and neighbour not in seen:
                        seen.add(neighbour)
                        stack.append(neighbour)
        boxes = [cells[member] for member in members]
        x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
        x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
        regions.append((len(members), x0, y0, x1 - x0 + 1, y1 - y0 + 1))
    regions.sort(key=lambda region: (-region[0], region[1], region[2]))
    return {
        "width": width,
        "height": height,
        "differing": differing,
        "antiAliased": anti_aliased,
        "regions": len(regions),
        "boxes": [f"x={x} y={y} w={w} h={h}" for _, x, y, w, h in regions[:MAX_BOXES]],
    }


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else "absent"


def report(results: Path) -> int:
    diffs = sorted(results.rglob("*-diff.png")) if results.is_dir() else []
    if not diffs:
        print(f"No screenshot diff images under {results}.")
        return 0
    for diff in diffs:
        stem = diff.name[: -len("-diff.png")]
        print(f"Screenshot diff: {diff.relative_to(results)}")
        if diff.stat().st_size > MAX_BYTES:
            print("  skipped: larger than 64 MiB")
            continue
        try:
            summary = summarize(*decode_png(diff.read_bytes()))
        except (ValueError, zlib.error, struct.error) as error:
            print(f"  undecodable: {error}")
            continue
        print(f"  size {summary['width']}x{summary['height']}; differing pixels {summary['differing']}; "
              f"anti-aliased pixels {summary['antiAliased']}; regions {summary['regions']}")
        for box in summary["boxes"]:
            print(f"  region {box}")
        for label in ("expected", "actual", "diff"):
            print(f"  sha256 {label} {digest(diff.with_name(f'{stem}-{label}.png'))}")
    return 0


def encode_png(width: int, height: int, pixel) -> bytes:
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw += bytes(pixel(x, y))
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return PNG_SIGNATURE + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


def self_test() -> int:
    def pixel(x: int, y: int) -> tuple[int, int, int, int]:
        if 10 <= x < 20 and 5 <= y < 8:
            return (255, 0, 0, 255)
        if 60 <= x < 62 and 40 <= y < 41:
            return (255, 0, 0, 255)
        if x == 30 and y == 30:
            return (255, 255, 0, 255)
        return (240, 240, 240, 255)
    summary = summarize(*decode_png(encode_png(80, 50, pixel)))
    expected = {"width": 80, "height": 50, "differing": 32, "antiAliased": 1, "regions": 2,
                "boxes": ["x=10 y=5 w=10 h=3", "x=60 y=40 w=2 h=1"]}
    assert summary == expected, summary
    blank = summarize(*decode_png(encode_png(4, 4, lambda x, y: (1, 2, 3, 255))))
    assert blank["differing"] == 0 and blank["regions"] == 0 and blank["boxes"] == [], blank
    # Every filter type must decode to the same pixels as filter 0.
    base = encode_png(5, 3, lambda x, y: ((x * 37) % 256, (y * 91) % 256, (x + y) % 256, 255))
    reference = decode_png(base)
    for filter_type in range(5):
        width, height, rows = reference
        raw = bytearray()
        previous = bytes(width * 4)
        for row in rows:
            encoded = bytearray(row)
            for i in range(len(row)):
                left = row[i - 4] if i >= 4 else 0
                up = previous[i]
                upper_left = previous[i - 4] if i >= 4 else 0
                if filter_type == 1:
                    encoded[i] = (row[i] - left) & 0xFF
                elif filter_type == 2:
                    encoded[i] = (row[i] - up) & 0xFF
                elif filter_type == 3:
                    encoded[i] = (row[i] - ((left + up) >> 1)) & 0xFF
                elif filter_type == 4:
                    estimate = left + up - upper_left
                    pa, pb, pc = abs(estimate - left), abs(estimate - up), abs(estimate - upper_left)
                    predictor = left if pa <= pb and pa <= pc else (up if pb <= pc else upper_left)
                    encoded[i] = (row[i] - predictor) & 0xFF
            raw += bytes([filter_type]) + encoded
            previous = row
        header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
        def chunk(kind: bytes, body: bytes) -> bytes:
            return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
        png = PNG_SIGNATURE + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(raw))) + chunk(b"IEND", b"")
        assert decode_png(png) == reference, filter_type
    try:
        decode_png(b"not a png")
    except ValueError:
        pass
    else:
        raise AssertionError("non-PNG input accepted")
    print("summarize-screenshot-diffs self-test passed")
    return 0


def main(argv: list[str]) -> int:
    if argv == ["--self-test"]:
        return self_test()
    if len(argv) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    return report(Path(argv[0]))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
