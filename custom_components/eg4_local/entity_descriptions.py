"""EG4 local-dongle sensor catalog + value extraction — PURE, no HA imports.

This module deliberately imports nothing from Home Assistant so the whole
sensor-value pipeline (which register/derived value feeds each entity, what
confidence and raw address it carries, and whether it is gated behind the
"expose provisional BMS fields" option) is unit-testable offline.

``sensor.py`` turns each :class:`SensorSpec` into a Home Assistant
``SensorEntity``, mapping the string ``device_class``/``state_class`` here onto
the HA enums. Keeping those as plain strings is what keeps this file HA-free.

Confidence discipline (mirrors eg4_local_monitor):
  * ``CONFIRMED``   — scale+unit cross-checked live against the EG4 cloud.
  * ``PROVISIONAL`` — raw value read correctly, meaning/scale reasoned but not
    independently confirmed on this device. Every provisional sensor says so in
    its ``confidence`` attribute; its ``name`` is the clean canonical form the
    dashboard resolves by (the dashboard adds its own "(provisional)" label). The
    provisional BMS block is only created when the option toggle asks for it.
"""
from __future__ import annotations

from dataclasses import dataclass, field

CONFIRMED = "confirmed"
PROVISIONAL = "provisional"

# Device-class / state-class string constants (mapped to HA enums in sensor.py).
DC_VOLTAGE = "voltage"
DC_CURRENT = "current"
DC_POWER = "power"
DC_ENERGY = "energy"
DC_FREQUENCY = "frequency"
DC_TEMPERATURE = "temperature"
DC_BATTERY = "battery"
DC_POWER_FACTOR = "power_factor"
DC_DURATION = "duration"
DC_APPARENT_POWER = "apparent_power"

SC_MEASUREMENT = "measurement"
SC_TOTAL_INCREASING = "total_increasing"

EC_DIAGNOSTIC = "diagnostic"


@dataclass(slots=True, frozen=True)
class SensorSpec:
    """One HA sensor, sourced from a decoded input-register snapshot.

    ``source`` is either ``("addr", N)`` — read ``decoded["by_addr"][N]`` — or
    ``("derived", key)`` — read ``decoded["derived"][key]``. Address-sourced
    specs inherit unit/confidence/raw from the decoder's Field; derived specs
    carry them here.
    """

    key: str                       # entity_id becomes sensor.eg4_local_<key>
    name: str                      # entity (friendly) name
    source: tuple                  # ("addr", int) | ("derived", str)
    unit: str | None = None
    device_class: str | None = None
    state_class: str | None = None
    confidence: str = CONFIRMED
    provisional: bool = False      # True -> only created when option toggle on
    raw_addr: object = None        # register address(es) for the attribute
    icon: str | None = None
    entity_category: str | None = None
    precision: int | None = None
    note: str = ""


# ---------------------------------------------------------------------------
# The catalog. Order here is display/creation order.
# CONFIRMED core telemetry first, then the BMS/cell block (the whole point),
# then the provisional BMS fields (gated), then diagnostics.
# ---------------------------------------------------------------------------
SENSOR_SPECS: tuple[SensorSpec, ...] = (
    # ---- PV strings (V + W; the register map exposes no per-string current) --
    SensorSpec("pv1_voltage", "PV1 voltage", ("addr", 1), "V", DC_VOLTAGE, SC_MEASUREMENT, raw_addr=1, precision=1),
    SensorSpec("pv2_voltage", "PV2 voltage", ("addr", 2), "V", DC_VOLTAGE, SC_MEASUREMENT, raw_addr=2, precision=1),
    SensorSpec("pv3_voltage", "PV3 voltage", ("addr", 3), "V", DC_VOLTAGE, SC_MEASUREMENT, raw_addr=3, precision=1),
    SensorSpec("pv1_power", "PV1 power", ("addr", 7), "W", DC_POWER, SC_MEASUREMENT, raw_addr=7),
    SensorSpec("pv2_power", "PV2 power", ("addr", 8), "W", DC_POWER, SC_MEASUREMENT, raw_addr=8),
    SensorSpec("pv3_power", "PV3 power", ("addr", 9), "W", DC_POWER, SC_MEASUREMENT, raw_addr=9),
    # ---- Battery pack (inverter-side view) --
    SensorSpec("battery_voltage", "Battery voltage", ("addr", 4), "V", DC_VOLTAGE, SC_MEASUREMENT, raw_addr=4, precision=1),
    SensorSpec("soc", "State of charge", ("derived", "soc_pct"), "%", DC_BATTERY, SC_MEASUREMENT, raw_addr=5),
    SensorSpec("soh", "State of Health", ("derived", "soh_pct"), "%", DC_BATTERY, SC_MEASUREMENT,
               confidence=PROVISIONAL, raw_addr=5, note="high byte of reg5; scale unconfirmed"),
    SensorSpec("battery_charge_power", "Battery charge power", ("addr", 10), "W", DC_POWER, SC_MEASUREMENT, raw_addr=10),
    SensorSpec("battery_discharge_power", "Battery discharge power", ("addr", 11), "W", DC_POWER, SC_MEASUREMENT, raw_addr=11),
    # ---- Grid / AC --
    SensorSpec("grid_voltage", "Grid Voltage R", ("addr", 12), "V", DC_VOLTAGE, SC_MEASUREMENT, raw_addr=12, precision=1),
    SensorSpec("grid_frequency", "Grid frequency", ("addr", 15), "Hz", DC_FREQUENCY, SC_MEASUREMENT, raw_addr=15, precision=2),
    SensorSpec("grid_export_power", "Power to Grid", ("addr", 26), "W", DC_POWER, SC_MEASUREMENT, raw_addr=26),
    SensorSpec("grid_import_power", "Power to User", ("addr", 27), "W", DC_POWER, SC_MEASUREMENT, raw_addr=27),
    # ---- Inverter AC --
    SensorSpec("inverter_power", "Inverter power", ("addr", 16), "W", DC_POWER, SC_MEASUREMENT, raw_addr=16),
    SensorSpec("inverter_current", "Inverter RMS current", ("addr", 18), "A", DC_CURRENT, SC_MEASUREMENT, raw_addr=18, precision=2),
    SensorSpec("power_factor", "Power factor", ("addr", 19), None, DC_POWER_FACTOR, SC_MEASUREMENT, raw_addr=19, precision=3),
    SensorSpec("bus1_voltage", "Bus 1 voltage", ("addr", 38), "V", DC_VOLTAGE, SC_MEASUREMENT, raw_addr=38,
               entity_category=EC_DIAGNOSTIC, precision=1),
    SensorSpec("bus2_voltage", "Bus 2 voltage", ("addr", 39), "V", DC_VOLTAGE, SC_MEASUREMENT, raw_addr=39,
               entity_category=EC_DIAGNOSTIC, precision=1),
    # ---- EPS / backup --
    SensorSpec("eps_voltage", "EPS voltage", ("addr", 20), "V", DC_VOLTAGE, SC_MEASUREMENT, raw_addr=20, precision=1),
    SensorSpec("eps_frequency", "EPS frequency", ("addr", 23), "Hz", DC_FREQUENCY, SC_MEASUREMENT, raw_addr=23, precision=2),
    SensorSpec("eps_power", "EPS active power", ("addr", 24), "W", DC_POWER, SC_MEASUREMENT, raw_addr=24),
    SensorSpec("eps_apparent_power", "EPS apparent power", ("addr", 25), "VA", DC_APPARENT_POWER, SC_MEASUREMENT, raw_addr=25),
    # ---- Temperatures (inverter side) --
    SensorSpec("inverter_temp", "Inverter internal temperature", ("addr", 64), "°C", DC_TEMPERATURE, SC_MEASUREMENT, raw_addr=64),
    SensorSpec("radiator1_temp", "Radiator 1 temperature", ("addr", 65), "°C", DC_TEMPERATURE, SC_MEASUREMENT, raw_addr=65),
    SensorSpec("radiator2_temp", "Radiator 2 temperature", ("addr", 66), "°C", DC_TEMPERATURE, SC_MEASUREMENT, raw_addr=66),
    # ---- Energy today (kWh, resets daily -> total_increasing) --
    SensorSpec("pv1_energy_today", "PV1 energy today", ("addr", 28), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=28, precision=1),
    SensorSpec("pv2_energy_today", "PV2 energy today", ("addr", 29), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=29, precision=1),
    SensorSpec("pv3_energy_today", "PV3 energy today", ("addr", 30), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=30, precision=1),
    SensorSpec("inverter_energy_today", "Inverter energy today", ("addr", 31), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=31, precision=1),
    SensorSpec("charge_energy_today", "Charge Energy Today", ("addr", 33), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=33, precision=1),
    SensorSpec("discharge_energy_today", "Discharge Energy Today", ("addr", 34), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=34, precision=1),
    SensorSpec("export_energy_today", "Export Energy Today", ("addr", 36), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=36, precision=1),
    SensorSpec("import_energy_today", "Import Energy Today", ("addr", 37), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=37, precision=1),
    # ---- Energy lifetime (u32 kWh) --
    SensorSpec("pv1_energy_total", "PV1 energy total", ("addr", 40), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=[40, 41], precision=1),
    SensorSpec("pv2_energy_total", "PV2 energy total", ("addr", 42), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=[42, 43], precision=1),
    SensorSpec("pv3_energy_total", "PV3 energy total", ("addr", 44), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=[44, 45], precision=1),
    SensorSpec("inverter_energy_total", "Inverter energy total", ("addr", 46), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=[46, 47], precision=1),
    SensorSpec("charge_energy_total", "Charge Energy Total", ("addr", 50), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=[50, 51], precision=1),
    SensorSpec("discharge_energy_total", "Discharge Energy Total", ("addr", 52), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=[52, 53], precision=1),
    SensorSpec("export_energy_total", "Export Energy Total", ("addr", 56), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=[56, 57], precision=1),
    SensorSpec("import_energy_total", "Import Energy Total", ("addr", 58), "kWh", DC_ENERGY, SC_TOTAL_INCREASING, raw_addr=[58, 59], precision=1),
    # ---- BMS / cells: CONFIRMED. The per-cell detail the EG4 cloud hides. --
    SensorSpec("pack_capacity", "Pack Capacity", ("addr", 83), "Ah", None, SC_MEASUREMENT, raw_addr=83,
               icon="mdi:battery-high"),
    SensorSpec("battery_modules", "Battery Modules", ("addr", 96), None, None, SC_MEASUREMENT, raw_addr=96,
               icon="mdi:battery-sync"),
    SensorSpec("cell_voltage_max", "Cell Voltage Max", ("addr", 101), "mV", DC_VOLTAGE, SC_MEASUREMENT, raw_addr=101,
               icon="mdi:battery-arrow-up"),
    SensorSpec("cell_voltage_min", "Cell Voltage Min", ("addr", 102), "mV", DC_VOLTAGE, SC_MEASUREMENT, raw_addr=102,
               icon="mdi:battery-arrow-down"),
    # The health signal: max-min cell spread. Both endpoints confirmed -> delta confirmed.
    SensorSpec("cell_voltage_delta", "Cell voltage delta", ("derived", "cell_v_delta_mV"), "mV", None, SC_MEASUREMENT,
               raw_addr=[101, 102], icon="mdi:delta", note="max cell mV - min cell mV; battery imbalance / health signal"),
    # ---- BMS / cells: PROVISIONAL (gated behind the expose-provisional option) --
    SensorSpec("cell_temp_max", "Cell Temperature Max", ("derived", "cell_temp_max_C"), "°C",
               DC_TEMPERATURE, SC_MEASUREMENT, confidence=PROVISIONAL, provisional=True, raw_addr=103,
               note="reg103 x0.1C; pairs with reg104. Credible battery temp (unlike reg67), scale unconfirmed."),
    SensorSpec("cell_temp_min", "Cell Temperature Min", ("derived", "cell_temp_min_C"), "°C",
               DC_TEMPERATURE, SC_MEASUREMENT, confidence=PROVISIONAL, provisional=True, raw_addr=104,
               note="reg104 x0.1C; credible AZ battery temp, scale unconfirmed."),
    SensorSpec("cycle_count", "Cycle Count", ("derived", "cycle_count"), None, None,
               SC_MEASUREMENT, confidence=PROVISIONAL, provisional=True, raw_addr=106, icon="mdi:battery-sync",
               note="reg106; ~1.4 cycles/day over runtime — consistent but unconfirmed."),
    SensorSpec("bms_pack_current", "BMS Pack Current", ("derived", "bms_pack_current_A"), "A",
               DC_CURRENT, SC_MEASUREMENT, confidence=PROVISIONAL, provisional=True, raw_addr=98, precision=1,
               note="reg98 x0.1A signed; sign/scale unconfirmed."),
    SensorSpec("remaining_capacity", "Remaining Capacity", ("addr", 107), "Ah", None,
               SC_MEASUREMENT, confidence=PROVISIONAL, provisional=True, raw_addr=107, icon="mdi:battery-medium",
               note="reg107 ~= capacity at 100% SOC; likely remaining Ah, unconfirmed."),
    SensorSpec("battery_temp_probe", "Battery temp — inverter probe (untrustworthy)", ("addr", 67), "°C",
               DC_TEMPERATURE, SC_MEASUREMENT, confidence=PROVISIONAL, provisional=True, raw_addr=67,
               entity_category=EC_DIAGNOSTIC,
               note="reg67 reads implausibly low; NOT a trustworthy battery temp. Use cell temp 103/104."),
    # ---- Diagnostics --
    SensorSpec("runtime", "Runtime", ("derived", "runtime_s"), "s", DC_DURATION, SC_TOTAL_INCREASING,
               raw_addr=[69, 70], entity_category=EC_DIAGNOSTIC),
    SensorSpec("fault_code", "Fault code", ("addr", 60), None, None, None, raw_addr=[60, 61],
               entity_category=EC_DIAGNOSTIC, icon="mdi:alert-circle"),
    SensorSpec("warning_code", "Warning code", ("addr", 62), None, None, None, raw_addr=[62, 63],
               entity_category=EC_DIAGNOSTIC, icon="mdi:alert"),
    # ---- Status / identity (derived) --
    # Inverter serial: a TEXT value (ASCII decoded from regs 115..119). No unit,
    # device_class, state_class or precision, so sensor.py publishes the string state
    # as-is (nothing coerces it to float). CONFIRMED — the serial decodes byte-exact.
    SensorSpec("inverter_serial", "Inverter Serial", ("derived", "inverter_serial"),
               raw_addr=[115, 116, 117, 118, 119], entity_category=EC_DIAGNOSTIC,
               icon="mdi:identifier", note="ASCII serial from regs 115..119"),
    # Inverter state: reg0 is a bitfield WORD, not a single enum. decode()/decode_state()
    # return a dict; extract() publishes the human-readable summary string and surfaces
    # the raw word and set bits as attributes. Provisional because decode_state() marks
    # the reading provisional (only bit2/running is seen in every active snapshot).
    SensorSpec("inverter_state", "Inverter State", ("derived", "state"), raw_addr=0,
               confidence=PROVISIONAL, entity_category=EC_DIAGNOSTIC, icon="mdi:state-machine",
               note="reg0 bitfield; see decode_state() -- not a single enum label"),
)


def iter_specs(expose_provisional: bool):
    """Yield the specs that should become entities given the option toggle."""
    for spec in SENSOR_SPECS:
        if spec.provisional and not expose_provisional:
            continue
        yield spec


def extract(spec: SensorSpec, decoded: dict) -> tuple[object, dict]:
    """Return ``(value, attributes)`` for ``spec`` from a decoded snapshot.

    ``value`` is ``None`` when the source register/derived value is absent
    (partial harvest) — the entity is then unavailable. ``attributes`` always
    carries ``confidence`` and ``raw_register`` so every entity is honest about
    what it is; address-sourced specs also surface the raw uint16 and any note
    from the decoder's Field.
    """
    kind, ref = spec.source
    attrs: dict[str, object] = {
        "confidence": spec.confidence,
        "raw_register": spec.raw_addr if spec.raw_addr is not None else None,
    }
    if kind == "addr":
        fld = decoded.get("by_addr", {}).get(ref)
        if fld is None:
            attrs["raw_value"] = None
            if spec.note:
                attrs["note"] = spec.note
            return None, attrs
        # The decoder's Field is the authority on confidence/unit for addr specs.
        attrs["confidence"] = fld.confidence
        attrs["raw_value"] = fld.raw
        note = spec.note or fld.note
        if note:
            attrs["note"] = note
        return fld.value, attrs

    # derived
    value = decoded.get("derived", {}).get(ref)
    if spec.note:
        attrs["note"] = spec.note
    # The reg-0 inverter-state derived value is a structured bitfield dict, not a
    # scalar. Publish a human-readable summary STRING as the state and surface the
    # raw word and the set bits as attributes, so the entity never reports a dict.
    if isinstance(value, dict):
        labels = value.get("labels") or []
        attrs["raw_value"] = value.get("raw")
        attrs["bits_set"] = value.get("bits_set")
        if value.get("confidence"):
            attrs["confidence"] = value["confidence"]
        summary = ", ".join(labels) if labels else (
            f"raw {value.get('raw')}" if value.get("raw") is not None else None
        )
        return summary, attrs
    return value, attrs


def merge_regs(prev: dict[int, int], new: dict[int, int]) -> dict[int, int]:
    """Overlay a fresh (possibly partial) harvest on the last-good registers.

    The dongle frequently answers only bank 0; overlaying keeps last-good values
    for the banks a poll missed instead of flapping those sensors to unavailable.
    Returns a new dict; inputs are not mutated.
    """
    merged = dict(prev)
    merged.update(new)
    return merged


def build_states(decoded: dict, expose_provisional: bool) -> dict[str, dict]:
    """Turn a decoded snapshot into per-entity state, keyed by sensor key.

    Pure counterpart of what the coordinator + sensor entities produce: for each
    spec that the option toggle keeps, ``{value, unit, device_class,
    state_class, attributes}``. Testable without Home Assistant.
    """
    out: dict[str, dict] = {}
    for spec in iter_specs(expose_provisional):
        value, attrs = extract(spec, decoded)
        out[spec.key] = {
            "value": value,
            "unit": spec.unit,
            "device_class": spec.device_class,
            "state_class": spec.state_class,
            "attributes": attrs,
        }
    return out
