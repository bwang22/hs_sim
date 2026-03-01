#!/usr/bin/env python3
"""
concat_ts.py

Concatenate all .ts files under the project root into a single text file.
Each file is prefixed with a header containing its relative path.

Usage:
  python concat_ts.py
  python concat_ts.py --out all_ts_dump.txt
  python concat_ts.py --root . --out all_ts_dump.txt
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Iterable


DEFAULT_OUT = "all_ts_dump.txt"

# Common folders to skip. Adjust as needed.
SKIP_DIRS = {
    "node_modules",
    "dist",
    "build",
    "out",
    ".git",
    ".svn",
    ".hg",
    ".idea",
    ".vscode",
    "__pycache__",
    ".next",
    ".turbo",
    ".cache",
    "coverage",
}


def iter_ts_files(root: Path) -> Iterable[Path]:
    for dirpath, dirnames, filenames in os.walk(root):
        # Prune skipped directories in-place to prevent walking them
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]

        for name in filenames:
            if not name.endswith(".ts"):
                continue
            # Often you don't want compiled declaration maps, etc.
            if name.endswith(".d.ts"):
                # comment this out if you DO want declarations included
                continue
            yield Path(dirpath) / name


def read_text_safe(path: Path) -> str:
    """
    Read file as text with a few reasonable fallbacks.
    """
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        # Fallback: try latin-1 to avoid crashing; preserves bytes 0-255
        return path.read_text(encoding="latin-1")


def main() -> int:
    parser = argparse.ArgumentParser(description="Concatenate all .ts files into one .txt dump.")
    parser.add_argument("--root", default=".", help="Project root to scan (default: .)")
    parser.add_argument("--out", default=DEFAULT_OUT, help=f"Output file at root (default: {DEFAULT_OUT})")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    out_path = (root / args.out).resolve()

    if not root.exists() or not root.is_dir():
        print(f"ERROR: root directory not found: {root}")
        return 2

    ts_files = sorted(iter_ts_files(root), key=lambda p: str(p.relative_to(root)).lower())

    if not ts_files:
        print("No .ts files found.")
        # Still create an empty output for consistency
        out_path.write_text("", encoding="utf-8")
        return 0

    parts: list[str] = []
    parts.append(f"# TS CONCAT DUMP\n# Root: {root}\n# Files: {len(ts_files)}\n\n")

    for path in ts_files:
        rel = path.relative_to(root).as_posix()
        content = read_text_safe(path)
        parts.append(f"\n\n# ========================================\n")
        parts.append(f"# FILE: {rel}\n")
        parts.append(f"# ========================================\n\n")
        parts.append(content.rstrip("\n"))
        parts.append("\n")

    out_text = "".join(parts)
    out_path.write_text(out_text, encoding="utf-8")

    print(f"Wrote {len(ts_files)} files into: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())