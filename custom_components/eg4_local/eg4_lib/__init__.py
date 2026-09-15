# ─────────────────────────────────────────────────────────────────────────
# VENDORED from eg4_local_monitor (package: eg4_dongle)
# Source of truth: github JeremyWhittaker/eg4_local_monitor @ a0aadee1a3e3a171665fcd61e4428188108969ec
# Vendored 2026-09-15 for the eg4_local Home Assistant integration (stdlib only).
# ─────────────────────────────────────────────────────────────────────────
"""Cloud-free codec + client for the EG4/LuxPower WiFi dongle (TCP/8000).

This is a dependency-free (stdlib only) subset of the ``eg4_dongle`` package,
vendored so the Home Assistant integration ships no PyPI requirements. The
``config.py`` module (args/env/.env resolution) is intentionally NOT vendored:
in Home Assistant the host/port/serials come from the config entry.

Public surface:
    EG4Dongle    robust TCP client (heartbeat echo, reliable multi-bank harvest)
    protocol     frame codec + Modbus CRC
    registers    input-register map + confidence-flagged decode()
"""
from __future__ import annotations

from . import protocol, registers
from .client import EG4Dongle, HarvestResult, IncompleteHarvest

__all__ = [
    "EG4Dongle",
    "HarvestResult",
    "IncompleteHarvest",
    "protocol",
    "registers",
]
