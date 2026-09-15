"""DataUpdateCoordinator for the EG4 local dongle.

Each interval it harvests all input banks over a fresh TCP session (the dongle is
single-session and flaky, so we do NOT hold a socket across polls and starve
other clients), merges the harvest over the last-good register map, and decodes.

Honesty about availability (the task's explicit requirement):
  * A partial harvest (the common case — the dongle often answers only bank 0)
    keeps last-good values for the banks it missed rather than flapping every
    sensor to ``unavailable``.
  * A poll that yields nothing is tolerated while recent data is still on hand:
    the last-good snapshot is served and marked stale, instead of a fleet-wide
    flap. Only after ``STALE_AFTER_FAILURES`` consecutive empty polls — or on the
    very first poll if the dongle was never reachable — does the coordinator
    report failure, so entities go unavailable honestly rather than lying
    forever.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .const import (
    CONF_DONGLE_SERIAL,
    CONF_EXPOSE_PROVISIONAL,
    CONF_HOST,
    CONF_INVERTER_SERIAL,
    CONF_PORT,
    CONF_SCAN_INTERVAL,
    DEFAULT_EXPOSE_PROVISIONAL,
    DEFAULT_SCAN_INTERVAL,
    DEVICE_NAME,
    DOMAIN,
    HARVEST_TIMEOUT,
    MANUFACTURER,
    MODEL,
)
from .eg4_lib import EG4Dongle
from .eg4_lib import registers as R
from .entity_descriptions import merge_regs

_LOGGER = logging.getLogger(__name__)

# Consecutive empty polls tolerated (serving last-good) before we admit failure.
STALE_AFTER_FAILURES = 10


@dataclass(slots=True)
class EG4Data:
    """One coordinator update result."""

    regs: dict[int, int]              # merged last-good register map
    decoded: dict                     # registers.decode(regs)
    complete: bool                    # this cycle harvested all three banks
    register_count: int               # registers in the merged map
    missing_banks: list[int]          # bank-starts this cycle did not complete
    stale: bool                       # served last-good; this cycle added nothing
    last_success: object = None       # datetime of the last cycle that added data


def blocking_harvest(
    host: str, port: int, dongle_sn: str, inverter_sn: str, timeout: float
) -> tuple[dict[int, int], object]:
    """Blocking: one full-bank harvest over a fresh session. Runs in the executor.

    Returns ``(regs_this_cycle, harvest_result)``. ``regs_this_cycle`` may be
    partial; ``harvest_result`` (the client's HarvestResult) says which banks
    landed. Any socket failure surfaces as an empty dict rather than an
    exception, so the coordinator decides what to do with a bad poll.
    """
    dongle = EG4Dongle(host, port, dongle_sn, inverter_sn)
    try:
        dongle.connect()
        regs = dongle.read_input_all(timeout=timeout)
        return regs, dongle.last_harvest
    except OSError as err:
        _LOGGER.debug("EG4 harvest connection failure: %s", err)
        return {}, None
    finally:
        dongle.close()


class EG4LocalCoordinator(DataUpdateCoordinator[EG4Data]):
    """Polls the dongle and exposes a decoded, confidence-flagged snapshot."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        interval = entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN} ({entry.data[CONF_INVERTER_SERIAL]})",
            update_interval=_as_timedelta(interval),
        )
        self.entry = entry
        self.host: str = entry.data[CONF_HOST]
        self.port: int = entry.data[CONF_PORT]
        self.dongle_serial: str = entry.data[CONF_DONGLE_SERIAL]
        self.inverter_serial: str = entry.data[CONF_INVERTER_SERIAL]
        self.expose_provisional: bool = entry.options.get(
            CONF_EXPOSE_PROVISIONAL, DEFAULT_EXPOSE_PROVISIONAL
        )
        self._last_regs: dict[int, int] = {}
        self._last_success = None
        self._consecutive_empty = 0

    @property
    def device_info(self) -> DeviceInfo:
        """Single HA device grouping every entity."""
        return DeviceInfo(
            identifiers={(DOMAIN, self.inverter_serial)},
            name=DEVICE_NAME,
            manufacturer=MANUFACTURER,
            model=MODEL,
            serial_number=self.inverter_serial,
            configuration_url=f"http://{self.host}",
        )

    async def _async_update_data(self) -> EG4Data:
        regs_cycle, harvest = await self.hass.async_add_executor_job(
            blocking_harvest,
            self.host,
            self.port,
            self.dongle_serial,
            self.inverter_serial,
            HARVEST_TIMEOUT,
        )

        got_data = bool(regs_cycle)
        if got_data:
            self._last_regs = merge_regs(self._last_regs, regs_cycle)
            self._last_success = dt_util.utcnow()
            self._consecutive_empty = 0
        else:
            self._consecutive_empty += 1
            if not self._last_regs:
                # Never reached the dongle at all — fail cleanly.
                raise UpdateFailed(
                    f"No data from EG4 dongle at {self.host}:{self.port} "
                    "(dongle unreachable or serials incorrect)"
                )
            if self._consecutive_empty >= STALE_AFTER_FAILURES:
                raise UpdateFailed(
                    f"EG4 dongle at {self.host}:{self.port} produced no data for "
                    f"{self._consecutive_empty} consecutive polls"
                )
            _LOGGER.debug(
                "EG4 poll produced no new data (%d/%d); serving last-good",
                self._consecutive_empty,
                STALE_AFTER_FAILURES,
            )

        decoded = R.decode(self._last_regs)
        complete = bool(harvest.complete) if harvest is not None else False
        missing = list(harvest.missing_banks) if harvest is not None else []
        return EG4Data(
            regs=dict(self._last_regs),
            decoded=decoded,
            complete=complete,
            register_count=len(self._last_regs),
            missing_banks=missing,
            stale=not got_data,
            last_success=self._last_success,
        )


def _as_timedelta(seconds: int):
    from datetime import timedelta

    return timedelta(seconds=int(seconds))
