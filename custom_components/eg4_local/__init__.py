"""EG4 Inverter (Local Dongle) — a cloud-free Home Assistant integration.

Talks directly to the EG4/LuxPower WiFi dongle over TCP/8000 and publishes its
telemetry — including the per-cell BMS data the EG4 cloud hides — as sensors.
The protocol/decode logic is vendored from eg4_local_monitor (see eg4_lib/).
"""
from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .coordinator import EG4LocalCoordinator

PLATFORMS: list[Platform] = [Platform.SENSOR]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up eg4_local from a config entry."""
    coordinator = EG4LocalCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unloaded


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload when options (poll interval / provisional toggle) change."""
    await hass.config_entries.async_reload(entry.entry_id)
