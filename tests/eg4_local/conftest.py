"""pytest bootstrap: install the HA-free ``eg4_local`` package stub before collection."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _util import install_package_stub  # noqa: E402

install_package_stub()
