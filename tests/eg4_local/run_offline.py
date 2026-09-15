"""Dependency-free runner for the offline eg4_local tests.

The environment has no pytest, so this discovers ``test_*`` functions in the
sibling ``test_*.py`` modules and runs them like pytest would (each is a plain
function using ``assert``). Exit code is non-zero if any test fails. When pytest
IS available (e.g. the HA test rig), ``python -m pytest tests/eg4_local`` runs
the very same files unchanged.
"""
from __future__ import annotations

import importlib
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import _util  # noqa: E402  (installs the HA-free eg4_local package stub)

_util.install_package_stub()

TEST_MODULES = sorted(p.stem for p in HERE.glob("test_*.py"))


def main() -> int:
    passed = failed = 0
    failures: list[str] = []
    for modname in TEST_MODULES:
        mod = importlib.import_module(modname)
        for name in sorted(vars(mod)):
            if not name.startswith("test_"):
                continue
            fn = getattr(mod, name)
            if not callable(fn):
                continue
            try:
                fn()
            except Exception:  # noqa: BLE001
                failed += 1
                failures.append(f"{modname}.{name}")
                print(f"FAIL {modname}.{name}")
                traceback.print_exc()
            else:
                passed += 1
                print(f"pass {modname}.{name}")
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
