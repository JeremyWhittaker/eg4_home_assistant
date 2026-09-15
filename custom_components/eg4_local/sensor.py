"""Sensor platform: one HA SensorEntity per SensorSpec.

Entity ids are forced to the deterministic ``sensor.eg4_local_<key>`` form so the
dashboard deployer can target them by id. Each entity carries its confidence flag
and the raw register address in ``extra_state_attributes`` — nothing provisional
is ever presented as confirmed.
"""
from __future__ import annotations

from homeassistant.components.sensor import (
    ENTITY_ID_FORMAT,
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import EG4LocalCoordinator
from .entity_descriptions import (
    SensorSpec,
    extract,
    iter_specs,
)

_DEVICE_CLASS_MAP: dict[str, SensorDeviceClass] = {
    "voltage": SensorDeviceClass.VOLTAGE,
    "current": SensorDeviceClass.CURRENT,
    "power": SensorDeviceClass.POWER,
    "energy": SensorDeviceClass.ENERGY,
    "frequency": SensorDeviceClass.FREQUENCY,
    "temperature": SensorDeviceClass.TEMPERATURE,
    "battery": SensorDeviceClass.BATTERY,
    "power_factor": SensorDeviceClass.POWER_FACTOR,
    "duration": SensorDeviceClass.DURATION,
    "apparent_power": SensorDeviceClass.APPARENT_POWER,
}

_STATE_CLASS_MAP: dict[str, SensorStateClass] = {
    "measurement": SensorStateClass.MEASUREMENT,
    "total_increasing": SensorStateClass.TOTAL_INCREASING,
}

_ENTITY_CATEGORY_MAP: dict[str, EntityCategory] = {
    "diagnostic": EntityCategory.DIAGNOSTIC,
}


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Create sensors for the specs the option toggle keeps."""
    coordinator: EG4LocalCoordinator = hass.data[DOMAIN][entry.entry_id]
    entities = [
        EG4LocalSensor(coordinator, spec)
        for spec in iter_specs(coordinator.expose_provisional)
    ]
    async_add_entities(entities)


class EG4LocalSensor(CoordinatorEntity[EG4LocalCoordinator], SensorEntity):
    """A single decoded field from the dongle."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: EG4LocalCoordinator, spec: SensorSpec) -> None:
        super().__init__(coordinator)
        self._spec = spec
        self._attr_unique_id = f"{coordinator.inverter_serial}_{spec.key}"
        # Deterministic entity_id: sensor.eg4_local_<key>.
        self.entity_id = ENTITY_ID_FORMAT.format(f"eg4_local_{spec.key}")
        self._attr_name = spec.name
        self._attr_device_info = coordinator.device_info
        self._attr_native_unit_of_measurement = spec.unit
        self._attr_device_class = _DEVICE_CLASS_MAP.get(spec.device_class)
        self._attr_state_class = _STATE_CLASS_MAP.get(spec.state_class)
        if spec.entity_category:
            self._attr_entity_category = _ENTITY_CATEGORY_MAP.get(spec.entity_category)
        if spec.icon:
            self._attr_icon = spec.icon
        if spec.precision is not None:
            self._attr_suggested_display_precision = spec.precision

    def _current(self) -> tuple[object, dict]:
        data = self.coordinator.data
        if data is None:
            return None, {"confidence": self._spec.confidence,
                          "raw_register": self._spec.raw_addr}
        return extract(self._spec, data.decoded)

    @property
    def native_value(self):
        return self._current()[0]

    @property
    def extra_state_attributes(self) -> dict:
        attrs = dict(self._current()[1])
        data = self.coordinator.data
        if data is not None and data.stale:
            # Be honest when this value is last-good rather than freshly harvested.
            attrs["stale"] = True
        return attrs

    @property
    def available(self) -> bool:
        # Present fields stay available across a partial harvest (last-good is
        # merged); a field never harvested yet reports unavailable, not a wrong 0.
        return super().available and self._current()[0] is not None

    @callback
    def _handle_coordinator_update(self) -> None:
        self.async_write_ha_state()
