"""Connection validation for the config flow — PURE, no HA imports.

Kept HA-free so the validation logic (connect, harvest bank 0, cross-check the
inverter serial the dongle reports) is unit-testable offline by monkeypatching
the client. config_flow.py runs :func:`validate_connection` in the executor.
"""
from __future__ import annotations

from .const import HARVEST_TIMEOUT
from .eg4_lib import EG4Dongle
from .eg4_lib import registers as R


class CannotConnect(Exception):
    """The dongle could not be reached at host:port."""


class NoData(Exception):
    """Connected, but no bank-0 telemetry arrived (busy dongle or wrong serials)."""


class SerialMismatch(Exception):
    """The dongle reported a different inverter serial than entered."""

    def __init__(self, reported: str) -> None:
        self.reported = reported
        super().__init__(reported)


def validate_connection(
    host: str,
    port: int,
    dongle_sn: str,
    inverter_sn: str,
    harvest_timeout: float = HARVEST_TIMEOUT,
    client_factory=EG4Dongle,
) -> str:
    """Blocking validation. Returns the confirmed inverter serial.

    Raises :class:`CannotConnect`, :class:`NoData`, or :class:`SerialMismatch`
    with actionable meaning. ``client_factory`` is injectable for tests.
    """
    dongle = client_factory(host, port, dongle_sn, inverter_sn)
    try:
        dongle.connect()
    except OSError as err:
        raise CannotConnect(str(err)) from err
    try:
        regs = dongle.read_input_all(timeout=harvest_timeout)
    except OSError as err:
        raise CannotConnect(str(err)) from err
    finally:
        dongle.close()

    harvest = dongle.last_harvest
    bank0_ok = bool(harvest and harvest.banks.get(0))
    if not regs or not bank0_ok:
        raise NoData("no bank-0 telemetry harvested")

    decoded = R.decode(regs)
    reported = decoded["derived"].get("inverter_serial")
    if reported and inverter_sn and reported != inverter_sn:
        raise SerialMismatch(reported)
    return reported or inverter_sn
