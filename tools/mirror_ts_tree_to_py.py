# tools/mirror_ts_tree_to_py.py
from __future__ import annotations

from pathlib import Path

TS_ROOT = Path("src")
PY_ROOT = Path("py") / "bgs_sim"

def ts_name_to_py(name: str) -> str:
    # file/dir name mapping: hyphen -> underscore, strip .ts
    if name.endswith(".ts"):
        name = name[:-3]
    return name.replace("-", "_") + ".py"

def dir_name_to_py(name: str) -> str:
    return name.replace("-", "_")

def main() -> None:
    if not TS_ROOT.exists():
        raise SystemExit("Expected ./src to exist")

    for ts_path in TS_ROOT.rglob("*.ts"):
        rel = ts_path.relative_to(TS_ROOT)

        py_parts = [dir_name_to_py(p) for p in rel.parts[:-1]]
        py_file = ts_name_to_py(rel.parts[-1])

        out_dir = PY_ROOT.joinpath(*py_parts)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "__init__.py").touch(exist_ok=True)  # make packages

        out_path = out_dir / py_file
        if out_path.exists():
            continue

        # very lightweight stub with breadcrumbs
        stub = f'''"""
AUTO-GENERATED STUB (mechanical mirror)

Source: {ts_path.as_posix()}

Porting rule: direct translation first (preserve behavior), refactor later.
"""
from __future__ import annotations
'''
        out_path.write_text(stub, encoding="utf-8")

    # package root init
    (PY_ROOT / "__init__.py").touch(exist_ok=True)
    print(f"Mirrored {TS_ROOT} -> {PY_ROOT}")

if __name__ == "__main__":
    main()
