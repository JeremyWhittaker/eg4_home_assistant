"""The VENDORED decode yields the confirmed values (proves the vendoring is intact)."""
from __future__ import annotations

from _util import load_regs

from eg4_local.eg4_lib import registers as R


def test_confirmed_scalar_scales():
    by_addr = R.decode(load_regs())["by_addr"]
    assert by_addr[1].value == 346.8 and by_addr[1].unit == "V"
    assert by_addr[1].confidence == R.CONFIRMED
    assert by_addr[2].value == 351.4
    assert by_addr[3].value == 358.7
    assert by_addr[4].value == 55.2 and by_addr[4].confidence == R.CONFIRMED
    assert by_addr[15].value == 59.96  # grid frequency, 0.01 Hz units


def test_derived_battery_and_cell_values():
    d = R.decode(load_regs())["derived"]
    assert d["soc_pct"] == 100
    assert d["soh_pct"] == 100
    assert d["cell_v_max_mV"] == 3514
    assert d["cell_v_min_mV"] == 3425
    assert d["cell_v_delta_mV"] == 89
    assert d["battery_count"] == 2
    assert d["pack_capacity_Ah"] == 560
    assert d["cell_temp_max_C"] == 40.0
    assert d["cell_temp_min_C"] == 37.0


def test_confirmed_bms_anchors_are_confirmed():
    by_addr = R.decode(load_regs())["by_addr"]
    assert by_addr[83].value == 560 and by_addr[83].confidence == R.CONFIRMED
    assert by_addr[96].value == 2 and by_addr[96].confidence == R.CONFIRMED
    assert by_addr[101].value == 3514 and by_addr[101].confidence == R.CONFIRMED
    assert by_addr[102].value == 3425 and by_addr[102].confidence == R.CONFIRMED


def test_provisional_fields_marked_provisional():
    by_addr = R.decode(load_regs())["by_addr"]
    assert by_addr[67].confidence == R.PROVISIONAL   # untrustworthy battery temp
    assert by_addr[103].confidence == R.PROVISIONAL  # cell temps: reasoned, not confirmed
    assert by_addr[104].confidence == R.PROVISIONAL


def test_serial_decodes():
    regs = load_regs()
    assert R.decode_serial(regs) == "3352670252"
    assert R.decode(regs)["derived"]["inverter_serial"] == "3352670252"


def test_partial_bank0_only_still_decodes():
    """Only bank 0 (0..126) landed — the block that carries all live telemetry."""
    full = load_regs()
    bank0 = {k: v for k, v in full.items() if k <= 126}
    d = R.decode(bank0)["derived"]
    assert d["soc_pct"] == 100
    assert d["cell_v_max_mV"] == 3514
    assert d["cell_v_delta_mV"] == 89
    assert d["pack_capacity_Ah"] == 560
    assert d["inverter_serial"] == "3352670252"
