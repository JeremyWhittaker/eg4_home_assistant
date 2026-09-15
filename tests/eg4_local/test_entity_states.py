"""Sensor value pipeline: decoded snapshot -> per-entity state, confidence, gating."""
from __future__ import annotations

from _util import load_regs

from eg4_local.eg4_lib import registers as R
from eg4_local import entity_descriptions as ed


def _states(expose_provisional: bool) -> dict:
    return ed.build_states(R.decode(load_regs()), expose_provisional)


def test_confirmed_sensor_values_and_units():
    s = _states(expose_provisional=True)
    assert s["pv1_voltage"]["value"] == 346.8
    assert s["pv1_voltage"]["unit"] == "V"
    assert s["pv1_voltage"]["device_class"] == "voltage"
    assert s["battery_voltage"]["value"] == 55.2
    assert s["grid_frequency"]["value"] == 59.96
    assert s["soc"]["value"] == 100
    assert s["soc"]["device_class"] == "battery"
    # Lifetime energy is a u32 pair — decode reassembles it.
    assert s["pv1_energy_total"]["value"] == R.decode(load_regs())["by_addr"][40].value


def test_bms_cell_sensors_confirmed():
    s = _states(expose_provisional=True)
    assert s["pack_capacity"]["value"] == 560
    assert s["battery_modules"]["value"] == 2
    assert s["cell_voltage_max"]["value"] == 3514
    assert s["cell_voltage_min"]["value"] == 3425
    assert s["cell_voltage_max"]["attributes"]["confidence"] == "confirmed"


def test_cell_voltage_delta_is_the_health_signal():
    s = _states(expose_provisional=True)
    delta = s["cell_voltage_delta"]
    assert delta["value"] == 3514 - 3425 == 89
    assert delta["unit"] == "mV"
    # delta is derived from two confirmed endpoints -> confirmed, both addrs cited.
    assert delta["attributes"]["confidence"] == "confirmed"
    assert delta["attributes"]["raw_register"] == [101, 102]


def test_provisional_fields_gated_off():
    off = _states(expose_provisional=False)
    for key in ("cell_temp_max", "cell_temp_min", "cycle_count",
                "bms_pack_current", "remaining_capacity", "battery_temp_probe"):
        assert key not in off, f"{key} must be hidden when toggle is off"
    # Confirmed fields remain regardless of the toggle.
    assert "cell_voltage_delta" in off and "soc" in off


def test_provisional_fields_present_and_labelled_when_on():
    on = _states(expose_provisional=True)
    ct = on["cell_temp_max"]
    assert ct["value"] == 40.0
    assert ct["attributes"]["confidence"] == "provisional"
    # Provisional entities announce it in the confidence attribute; the name is now
    # the clean canonical form the dashboard resolves by (no "(provisional)" suffix —
    # the dashboard adds its own label).
    spec = {s.key: s for s in ed.SENSOR_SPECS}["cell_temp_max"]
    assert spec.name == "Cell Temperature Max"
    assert spec.confidence == "provisional"
    assert "provisional" not in spec.name.lower()
    assert on["cycle_count"]["value"] == 1122
    assert on["bms_pack_current"]["value"] == -0.7


def test_every_sensor_attr_carries_confidence_and_raw_register():
    for key, st in _states(expose_provisional=True).items():
        attrs = st["attributes"]
        assert "confidence" in attrs, key
        assert attrs["confidence"] in ("confirmed", "provisional"), key
        assert "raw_register" in attrs, key
        assert attrs["raw_register"] is not None, key


def test_missing_register_yields_none_value():
    # Empty snapshot -> partial harvest: every value None (entity unavailable),
    # but the confidence/raw metadata is still emitted.
    empty = ed.build_states(R.decode({}), expose_provisional=True)
    assert empty["pv1_voltage"]["value"] is None
    assert empty["pv1_voltage"]["attributes"]["confidence"] == "confirmed"


def test_entity_keys_are_deterministic_slugs():
    for spec in ed.SENSOR_SPECS:
        assert spec.key == spec.key.lower()
        assert " " not in spec.key
        # entity_id the sensor platform builds: sensor.eg4_local_<key>
        assert all(c.isalnum() or c == "_" for c in spec.key)
