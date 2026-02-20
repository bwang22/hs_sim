#!/usr/bin/env python3
"""
concat_folder_texts.py

Concatenate text from files in a folder into one output file, delimiting each
file's contents with a header line like:

#relative/path/to/file.ext

Usage:
  python concat_folder_texts.py /path/to/input_folder -o combined.txt
  python concat_folder_texts.py /path/to/input_folder -o combined.txt --recursive
  python concat_folder_texts.py /path/to/input_folder -o combined.txt --ext .txt .md .py
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable, List, Set


DEFAULT_EXTS = {
    ".txt", ".md", ".rst",
    ".py", ".js", ".ts", ".json", ".yaml", ".yml",
    ".toml", ".ini", ".cfg",
    ".html", ".css",
    ".java", ".go", ".rs", ".cpp", ".c", ".h",
    ".sh", ".bat", ".ps1",
    ".sql",
}


def iter_files(root: Path, recursive: bool) -> Iterable[Path]:
    if recursive:
        yield from (p for p in root.rglob("*") if p.is_file())
    else:
        yield from (p for p in root.glob("*") if p.is_file())


def read_text_safely(path: Path) -> str:
    # Try UTF-8 first, then a forgiving fallback
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        # latin-1 never fails decoding; best-effort for odd encodings
        return path.read_text(encoding="latin-1", errors="replace")


def normalize_exts(exts: List[str]) -> Set[str]:
    out = set()
    for e in exts:
        e = e.strip()
        if not e:
            continue
        if not e.startswith("."):
            e = "." + e
        out.add(e.lower())
    return out


def concat_folder(
    input_dir: Path,
    output_file: Path,
    recursive: bool,
    exts: Set[str] | None,
    include_hidden: bool,
) -> int:
    if not input_dir.exists() or not input_dir.is_dir():
        raise SystemExit(f"Input path is not a folder: {input_dir}")

    files = []
    for p in iter_files(input_dir, recursive=recursive):
        if not include_hidden:
            # skip hidden files/folders on Unix-ish systems (dotfiles)
            if any(part.startswith(".") for part in p.relative_to(input_dir).parts):
                continue

        if exts is not None:
            if p.suffix.lower() not in exts:
                continue

        files.append(p)

    files.sort(key=lambda x: str(x.relative_to(input_dir)).lower())

    output_file.parent.mkdir(parents=True, exist_ok=True)

    written = 0
    with output_file.open("w", encoding="utf-8", newline="\n") as out:
        for i, f in enumerate(files):
            rel = f.relative_to(input_dir).as_posix()
            out.write(f"#{rel}\n")
            out.write(read_text_safely(f).rstrip("\n"))
            out.write("\n\n")  # blank line between files for readability
            written += 1

    return written


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Concatenate text files in a folder into one .txt, delimiting each file with #filename."
    )
    parser.add_argument("input_path", help="Folder containing files to concatenate.")
    parser.add_argument(
        "-o", "--output",
        default="concat_output.txt",
        help="Output .txt file path (default: concat_output.txt)."
    )
    parser.add_argument(
        "--recursive",
        action="store_true",
        help="Include files in subfolders (recursive)."
    )
    parser.add_argument(
        "--ext",
        nargs="*",
        default=None,
        help="File extensions to include (e.g., --ext .txt .md .py). Default is a broad text-like set."
    )
    parser.add_argument(
        "--all-files",
        action="store_true",
        help="Include all files regardless of extension (still skips hidden unless --include-hidden)."
    )
    parser.add_argument(
        "--include-hidden",
        action="store_true",
        help="Include hidden files/folders (dotfiles)."
    )

    args = parser.parse_args()

    input_dir = Path(args.input_path).expanduser().resolve()
    output_file = Path(args.output).expanduser().resolve()

    if args.all_files:
        exts = None
    else:
        exts = normalize_exts(args.ext) if args.ext is not None else set(DEFAULT_EXTS)

    count = concat_folder(
        input_dir=input_dir,
        output_file=output_file,
        recursive=args.recursive,
        exts=exts,
        include_hidden=args.include_hidden,
    )

    print(f"✅ Wrote {count} file(s) into: {output_file}")


if __name__ == "__main__":
    main()
