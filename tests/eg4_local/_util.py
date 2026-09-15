"""Shared helpers for the offline eg4_local tests.

These tests are OFFLINE and import only the integration's PURE modules — the
vendored codec (``eg4_local.eg4_lib``), ``entity_descriptions``, ``validation``
and ``scanner`` — none of which import Home Assistant. To import those submodules
without executing the package's HA-dependent ``__init__.py``, we register a stub
``eg4_local`` package in ``sys.modules`` whose ``__path__`` points at the real
directory. Submodule imports then resolve their relative imports against the stub
and never run the real package init.

The config_flow / coordinator / sensor / __init__ modules DO import Home
Assistant and therefore need a HA test rig (pytest-homeassistant-custom-component)
to import — see the note in the task return. Their pure logic is factored into
the modules tested here.
"""
from __future__ import annotations

import contextlib
import json
import sys
import types
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_PKG_DIR = _REPO / "custom_components" / "eg4_local"
_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "input_snapshot.json"


def install_package_stub() -> None:
    """Register a HA-free stub for the ``eg4_local`` package (idempotent)."""
    if "eg4_local" in sys.modules and getattr(
        sys.modules["eg4_local"], "_eg4_test_stub", False
    ):
        return
    pkg = types.ModuleType("eg4_local")
    pkg.__path__ = [str(_PKG_DIR)]  # type: ignore[attr-defined]
    pkg._eg4_test_stub = True  # type: ignore[attr-defined]
    sys.modules["eg4_local"] = pkg


def load_regs() -> dict[int, int]:
    """The committed full 0..380 input snapshot as {int addr: int value}."""
    data = json.loads(_FIXTURE.read_text())
    return {int(k): v for k, v in data.items()}


@contextlib.contextmanager
def raises(exc_type):
    """Minimal pytest.raises stand-in so tests run with or without pytest."""
    try:
        yield
    except exc_type:
        return
    except Exception as err:  # noqa: BLE001
        raise AssertionError(
            f"expected {exc_type.__name__}, got {type(err).__name__}: {err}"
        ) from err
    raise AssertionError(f"expected {exc_type.__name__}, nothing raised")


install_package_stub()
