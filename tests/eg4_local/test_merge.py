"""Coordinator merge logic: a partial harvest keeps last-good values, no flapping."""
from __future__ import annotations

from _util import load_regs

from eg4_local.eg4_lib import registers as R
from eg4_local import entity_descriptions as ed


def test_merge_keeps_last_good_for_missing_banks():
    full = load_regs()
    # First poll: full snapshot. Second poll: only bank 0 (0..126) came back.
    prev = dict(full)
    bank0_only = {k: v for k, v in full.items() if k <= 126}
    merged = ed.merge_regs(prev, bank0_only)
    # High-bank register present only in the first poll survives the partial one.
    assert 257 in merged and merged[257] == full[257]
    # Bank-0 live value is refreshed from the new poll.
    assert merged[1] == bank0_only[1]


def test_merge_refreshes_changed_values():
    prev = {1: 3468, 4: 552}
    new = {1: 3500}          # PV1 voltage moved; battery voltage not re-sent
    merged = ed.merge_regs(prev, new)
    assert merged[1] == 3500        # refreshed
    assert merged[4] == 552         # last-good retained
    # inputs untouched
    assert prev[1] == 3468


def test_merge_does_not_mutate_inputs():
    prev = {1: 10}
    new = {2: 20}
    merged = ed.merge_regs(prev, new)
    assert prev == {1: 10} and new == {2: 20}
    assert merged == {1: 10, 2: 20}


def test_merged_partial_still_decodes_confirmed_block():
    """Simulate the coordinator: merge bank0-only over empty, decode, build states."""
    full = load_regs()
    bank0_only = {k: v for k, v in full.items() if k <= 126}
    merged = ed.merge_regs({}, bank0_only)
    states = ed.build_states(R.decode(merged), expose_provisional=True)
    assert states["soc"]["value"] == 100
    assert states["cell_voltage_delta"]["value"] == 89
    # A high-bank-only field never harvested -> value None (honest unavailable).
    # reg257 is unmapped, so pick a real high-bank sensor: none map above 126 in
    # the confirmed set, so assert the confirmed low-bank set is fully populated.
    assert states["pack_capacity"]["value"] == 560
