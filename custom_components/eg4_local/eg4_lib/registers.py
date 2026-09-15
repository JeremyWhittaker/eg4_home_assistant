# ─────────────────────────────────────────────────────────────────────────
# VENDORED from eg4_local_monitor  (package: eg4_dongle/registers.py)
# Source of truth: github JeremyWhittaker/eg4_local_monitor @ a0aadee1a3e3a171665fcd61e4428188108969ec
# Do NOT edit the protocol framing, validated register scales, or the
# confidence flags here — fix them upstream in eg4_local_monitor and re-vendor.
# Vendored 2026-09-15 for the eg4_local Home Assistant integration (stdlib only).
# ─────────────────────────────────────────────────────────────────────────
"""EG4 18kPV input-register map and structured decoder.

Scope: input registers (dev_fn 0x04) 0..380, delivered by the dongle in three
native banks 0..126 / 127..253 / 254..380.

Honesty policy (matches the rest of Jeremy's repos):
  * confidence="confirmed"   -> scale+unit cross-checked. The 0..69 core block
    was validated live 2026-09-15 against the EG4 cloud (PV string volts, Vbat,
    SOC, PV power, grid export, inverter temps all agreed). The BMS anchors
    (pack capacity 560 Ah, module count 2, max/min cell mV) matched the cloud's
    per-battery view, and the serial at 115..119 decodes byte-exact.
  * confidence="provisional" -> the RAW value is read correctly, but the
    meaning/scale is reasoned (arithmetic or the LuxPower/EG4 family map) and
    NOT independently cross-confirmed on this device. Never presented as fact.
  * everything unmapped is reported as reserved (reads zero) or unknown-raw
    (reads non-zero but meaning unknown) so there are no silent gaps.

decode(regs) returns a structured, grouped result the CLI consumes; see its
docstring for the contract. This device's serials/IP are configuration and
never hardcoded in importable paths -- the values in comments are documentation
of the one unit this map was reverse-engineered against.
"""
from __future__ import annotations

from dataclasses import dataclass

CONFIRMED = "confirmed"
PROVISIONAL = "provisional"


@dataclass(slots=True)
class Reg:
    name: str
    scale: float = 1.0
    unit: str = ""
    signed: bool = False
    u32: bool = False           # 32-bit little-endian pair (this reg = low word)
    confidence: str = PROVISIONAL
    group: str = "Other"
    note: str = ""


# ---------------------------------------------------------------------------
# Core runtime block, input registers 0..69.
# Scales here are CONFIRMED against the EG4 cloud; do not change them.
# (reg 0 state and reg 67 battery-temp get special/honest handling below.)
# ---------------------------------------------------------------------------
INPUT_MAP: dict[int, Reg] = {
    0:  Reg("Inverter state", confidence=PROVISIONAL, group="Status",
            note="bitfield word; see decode_state() -- not a single enum label"),
    1:  Reg("PV1 voltage", 0.1, "V", confidence=CONFIRMED, group="PV"),
    2:  Reg("PV2 voltage", 0.1, "V", confidence=CONFIRMED, group="PV"),
    3:  Reg("PV3 voltage", 0.1, "V", confidence=CONFIRMED, group="PV"),
    4:  Reg("Battery voltage", 0.1, "V", confidence=CONFIRMED, group="Battery"),
    # reg 5 is a packed SOC(low)/SOH(high) byte pair -- handled in decode().
    6:  Reg("Reg6 (raw, unknown)", confidence=PROVISIONAL, group="Battery",
            note="reads 11540 (bytes 20,45); meaning not confirmed"),
    7:  Reg("PV1 power", 1, "W", confidence=CONFIRMED, group="PV"),
    8:  Reg("PV2 power", 1, "W", confidence=CONFIRMED, group="PV"),
    9:  Reg("PV3 power", 1, "W", confidence=CONFIRMED, group="PV"),
    10: Reg("Battery charge power", 1, "W", confidence=CONFIRMED, group="Battery"),
    11: Reg("Battery discharge power", 1, "W", confidence=CONFIRMED, group="Battery"),
    12: Reg("Grid voltage R", 0.1, "V", confidence=CONFIRMED, group="Grid/AC",
            note="242.4 V = split-phase L1-L2 (240 V nominal)"),
    13: Reg("Grid voltage S", 0.1, "V", confidence=CONFIRMED, group="Grid/AC",
            note="reads 25.7 V; S/T unused on split-phase, residual only"),
    14: Reg("Grid voltage T", 0.1, "V", confidence=CONFIRMED, group="Grid/AC",
            note="reads 1.6 V; S/T unused on split-phase, residual only"),
    15: Reg("Grid frequency", 0.01, "Hz", confidence=CONFIRMED, group="Grid/AC"),
    16: Reg("Inverter power", 1, "W", confidence=CONFIRMED, group="Inverter AC"),
    17: Reg("Rectifier/charge power", 1, "W", confidence=CONFIRMED, group="Inverter AC"),
    18: Reg("Inverter RMS current", 0.01, "A", confidence=CONFIRMED, group="Inverter AC"),
    19: Reg("Power factor", 0.001, "", confidence=CONFIRMED, group="Inverter AC"),
    20: Reg("EPS voltage R", 0.1, "V", confidence=CONFIRMED, group="EPS/Backup",
            note="242.5 V, matches grid R -- this split-phase system's backup leg"),
    21: Reg("EPS voltage S", 0.1, "V", confidence=PROVISIONAL, group="EPS/Backup",
            note="reads 5245.7 V (impossible); S/T unused on this split-phase unit -- do not trust"),
    22: Reg("EPS voltage T", 0.1, "V", confidence=PROVISIONAL, group="EPS/Backup",
            note="reads 1543.4 V (impossible); S/T unused on this split-phase unit -- do not trust"),
    23: Reg("EPS frequency", 0.01, "Hz", confidence=CONFIRMED, group="EPS/Backup"),
    24: Reg("EPS active power", 1, "W", confidence=CONFIRMED, group="EPS/Backup"),
    25: Reg("EPS apparent power", 1, "VA", confidence=CONFIRMED, group="EPS/Backup"),
    26: Reg("Power to grid (export)", 1, "W", confidence=CONFIRMED, group="Grid/AC"),
    27: Reg("Power to user (import)", 1, "W", confidence=CONFIRMED, group="Grid/AC"),
    28: Reg("PV1 energy today", 0.1, "kWh", confidence=CONFIRMED, group="Energy today"),
    29: Reg("PV2 energy today", 0.1, "kWh", confidence=CONFIRMED, group="Energy today"),
    30: Reg("PV3 energy today", 0.1, "kWh", confidence=CONFIRMED, group="Energy today"),
    31: Reg("Inverter energy today", 0.1, "kWh", confidence=CONFIRMED, group="Energy today"),
    32: Reg("Rectifier energy today", 0.1, "kWh", confidence=CONFIRMED, group="Energy today"),
    33: Reg("Charge energy today", 0.1, "kWh", confidence=CONFIRMED, group="Energy today"),
    34: Reg("Discharge energy today", 0.1, "kWh", confidence=CONFIRMED, group="Energy today"),
    35: Reg("EPS energy today", 0.1, "kWh", confidence=CONFIRMED, group="Energy today"),
    36: Reg("Export energy today", 0.1, "kWh", confidence=CONFIRMED, group="Energy today"),
    37: Reg("Import energy today", 0.1, "kWh", confidence=CONFIRMED, group="Energy today"),
    38: Reg("Bus 1 voltage", 0.1, "V", confidence=CONFIRMED, group="Inverter AC"),
    39: Reg("Bus 2 voltage", 0.1, "V", confidence=CONFIRMED, group="Inverter AC"),
    40: Reg("PV1 energy total", 0.1, "kWh", u32=True, confidence=CONFIRMED, group="Energy total"),
    42: Reg("PV2 energy total", 0.1, "kWh", u32=True, confidence=CONFIRMED, group="Energy total"),
    44: Reg("PV3 energy total", 0.1, "kWh", u32=True, confidence=CONFIRMED, group="Energy total"),
    46: Reg("Inverter energy total", 0.1, "kWh", u32=True, confidence=CONFIRMED, group="Energy total"),
    48: Reg("Rectifier energy total", 0.1, "kWh", u32=True, confidence=CONFIRMED, group="Energy total"),
    50: Reg("Charge energy total", 0.1, "kWh", u32=True, confidence=CONFIRMED, group="Energy total"),
    52: Reg("Discharge energy total", 0.1, "kWh", u32=True, confidence=CONFIRMED, group="Energy total"),
    54: Reg("EPS energy total", 0.1, "kWh", u32=True, confidence=CONFIRMED, group="Energy total"),
    56: Reg("Export energy total", 0.1, "kWh", u32=True, confidence=CONFIRMED, group="Energy total"),
    58: Reg("Import energy total", 0.1, "kWh", u32=True, confidence=CONFIRMED, group="Energy total"),
    60: Reg("Fault code", 1, "", u32=True, confidence=CONFIRMED, group="Status"),
    62: Reg("Warning code", 1, "", u32=True, confidence=CONFIRMED, group="Status"),
    64: Reg("Inverter internal temp", 1, "°C", signed=True, confidence=CONFIRMED, group="Temperatures"),
    65: Reg("Radiator 1 temp", 1, "°C", signed=True, confidence=CONFIRMED, group="Temperatures"),
    66: Reg("Radiator 2 temp", 1, "°C", signed=True, confidence=CONFIRMED, group="Temperatures"),
    # reg 67: DEMOTED. Reads 5 -> not a believable Arizona battery temperature.
    # The trustworthy battery temperature is the BMS max/min cell temp (103/104).
    67: Reg("Battery temp (inverter probe -- UNTRUSTWORTHY)", 1, "°C", signed=True,
            confidence=PROVISIONAL, group="Temperatures",
            note="reads 5; inverter-side probe, not credible. Use BMS cell temp 103/104."),
    69: Reg("Runtime", 1, "s", u32=True, confidence=CONFIRMED, group="Status"),
    # 70 is the high word of the u32 runtime at 69.
    77: Reg("Reg77 (raw, unknown)", confidence=PROVISIONAL, group="Other", note="reads 224"),
    78: Reg("Reg78 (raw, unknown)", confidence=PROVISIONAL, group="Other", note="reads 1"),
    79: Reg("Reg79 (raw, unknown)", confidence=PROVISIONAL, group="Other", note="reads 1"),
}

# ---------------------------------------------------------------------------
# BMS / battery block, input registers 80..126. This is the per-battery data
# the EG4 cloud hides and Jeremy is after. Confirmed where the live value matched
# a known quantity; the rest is reasoned + marked provisional, never asserted.
# reg 115..119 are the inverter serial ASCII -- decoded in decode(), not here.
# ---------------------------------------------------------------------------
BMS_MAP: dict[int, Reg] = {
    80:  Reg("BMS status/count word (raw)", confidence=PROVISIONAL, group="BMS/Cells", note="reads 2"),
    81:  Reg("BMS charge current limit?", 1, "A", confidence=PROVISIONAL, group="BMS/Cells",
             note="reads 200; candidate charge-current limit, unconfirmed"),
    82:  Reg("BMS limit word (raw)", confidence=PROVISIONAL, group="BMS/Cells",
             note="reads 4000; scale/meaning unresolved"),
    83:  Reg("Pack capacity", 1, "Ah", confidence=CONFIRMED, group="BMS/Cells",
             note="560 Ah = 2 x 280 Ah, matches cloud"),
    84:  Reg("BMS discharge current limit?", 1, "A", confidence=PROVISIONAL, group="BMS/Cells",
             note="reads 450; candidate discharge-current limit, unconfirmed"),
    90:  Reg("BMS flags word (raw)", confidence=PROVISIONAL, group="BMS/Cells",
             note="reads 192 (0x00C0); status/flag bits, unconfirmed"),
    95:  Reg("BMS module/string count (raw)", confidence=PROVISIONAL, group="BMS/Cells",
             note="reads 3; distinct from confirmed battery count 2"),
    96:  Reg("Battery module count", 1, "", confidence=CONFIRMED, group="BMS/Cells",
             note="2 batteries, matches cloud"),
    97:  Reg("Full-charge capacity?", 1, "Ah", confidence=PROVISIONAL, group="BMS/Cells",
             note="reads 560; mirrors pack capacity, likely full-charge capacity"),
    98:  Reg("BMS pack current", 0.1, "A", signed=True, confidence=PROVISIONAL, group="BMS/Cells",
             note="reads -7 -> -0.7 A idle draw; sign/scale unconfirmed"),
    101: Reg("Max cell voltage", 1, "mV", confidence=CONFIRMED, group="BMS/Cells"),
    102: Reg("Min cell voltage", 1, "mV", confidence=CONFIRMED, group="BMS/Cells"),
    103: Reg("Max cell temperature", 0.1, "°C", signed=True, confidence=PROVISIONAL, group="BMS/Cells",
             note="reads 400 -> 40.0 C; pairs with 104 like 101/102 do. THIS is the real battery temp."),
    104: Reg("Min cell temperature", 0.1, "°C", signed=True, confidence=PROVISIONAL, group="BMS/Cells",
             note="reads 370 -> 37.0 C; credible AZ battery temp, unlike reg67=5"),
    106: Reg("Cycle count?", 1, "", confidence=PROVISIONAL, group="BMS/Cells",
             note="reads 1122; ~1.4 cycles/day over 809 d runtime -- consistent, unconfirmed"),
    107: Reg("Remaining capacity?", 1, "Ah", confidence=PROVISIONAL, group="BMS/Cells",
             note="reads 559 ~= 560 at SOC 100%; likely remaining capacity"),
    108: Reg("BMS reg108 (raw)", confidence=PROVISIONAL, group="BMS/Cells", note="reads 401"),
    113: Reg("BMS reg113 (raw)", confidence=PROVISIONAL, group="BMS/Cells", note="reads 261"),
    114: Reg("BMS reg114 (raw)", confidence=PROVISIONAL, group="BMS/Cells", note="reads 4516"),
    120: Reg("BMS reg120 (raw)", confidence=PROVISIONAL, group="BMS/Cells", note="reads 1862"),
}

# Inverter serial ASCII lives at 115..119 (two chars/reg, little-endian).
SERIAL_REGS = (115, 116, 117, 118, 119)

# Provisional bit interpretation for the reg-0 state word. Only bit 2 is
# observed set in every running snapshot; the rest are shown as raw set bits.
STATE_BITS: dict[int, str] = {
    2: "Normal / running (provisional)",
    3: "Grid-connected / feeding (provisional)",
}

# Group order for display.
GROUP_ORDER = [
    "Status", "PV", "Battery", "BMS/Cells", "Grid/AC", "Inverter AC",
    "EPS/Backup", "Temperatures", "Energy today", "Energy total",
    "Identity", "Other", "Unmapped (non-zero)",
]


@dataclass(slots=True)
class Field:
    addr: int
    name: str
    value: object
    unit: str
    confidence: str
    raw: object
    group: str
    note: str = ""

    def as_dict(self) -> dict:
        return {
            "addr": self.addr, "name": self.name, "value": self.value,
            "unit": self.unit, "confidence": self.confidence, "raw": self.raw,
            "group": self.group, "note": self.note,
        }


def _s16(v: int) -> int:
    return v - 0x10000 if v >= 0x8000 else v


def _raw(regs: dict[int, int], addr: int, reg: Reg):
    if reg.u32:
        lo, hi = regs.get(addr), regs.get(addr + 1)
        if lo is None or hi is None:
            return None
        return lo | (hi << 16)
    v = regs.get(addr)
    if v is None:
        return None
    return _s16(v) if reg.signed else v


def _scaled(raw, reg: Reg):
    if raw is None:
        return None
    return round(raw * reg.scale, 3) if reg.scale != 1 else raw


def decode_serial(regs: dict[int, int]) -> str | None:
    """Inverter serial from regs 115..119 (ASCII, little-endian char pairs)."""
    try:
        b = b"".join(regs[a].to_bytes(2, "little") for a in SERIAL_REGS)
    except (KeyError, AttributeError, OverflowError):
        return None
    s = b.decode("latin1", "replace").strip("\x00 ")
    return s or None


def decode_state(regs: dict[int, int]) -> dict | None:
    """reg 0 is a state WORD, not a single enum. Report raw + set bits + a
    provisional reading, so nothing is asserted as one label."""
    v = regs.get(0)
    if v is None:
        return None
    bits = [i for i in range(16) if v & (1 << i)]
    labels = [STATE_BITS.get(i, f"bit{i} (raw)") for i in bits]
    return {
        "raw": v,
        "bits_set": bits,
        "labels": labels,
        "confidence": PROVISIONAL,
        "note": "state is a bitfield; only bit2 (running) is seen in every "
                "active snapshot -- other bits shown raw",
    }


def _field(regs, addr, reg: Reg) -> Field:
    raw = _raw(regs, addr, reg)
    return Field(addr, reg.name, _scaled(raw, reg), reg.unit,
                 reg.confidence, raw, reg.group, reg.note)


def decode(regs: dict[int, int]) -> dict:
    """Decode a full/partial input-register snapshot into structured data.

    `regs` maps int address -> uint16 value (as harvested from the dongle).

    Returns::

        {
          "fields":   [Field, ...],            # every mapped field, addr order
          "groups":   {group_name: [Field]},   # same fields, grouped, ordered
          "by_addr":  {addr: Field},           # first field at each address
          "derived":  {...},                   # serial, SOC, cell delta, state
          "coverage": {addr: "named"|"reserved"|"unknown"} for all 0..380,
          "counts":   {"named","reserved","unknown","total"},  # by ADDRESS
        }

    Every field carries name/value/unit/confidence so the CLI never has to
    guess what is confirmed vs provisional. Field objects expose .as_dict().
    """
    fields: list[Field] = []
    named_addrs: set[int] = set()

    # -- mapped scalar / u32 fields (skip 0, 5, 67-handled-normally, serial) --
    for addr, reg in sorted({**INPUT_MAP, **BMS_MAP}.items()):
        if addr == 0:
            continue  # emitted as a state field below
        f = _field(regs, addr, reg)
        fields.append(f)
        named_addrs.add(addr)
        if reg.u32:
            named_addrs.add(addr + 1)

    # -- reg 0 inverter state (special) --
    state = decode_state(regs)
    if state is not None:
        fields.append(Field(0, "Inverter state", state["labels"], "",
                            PROVISIONAL, state["raw"], "Status", state["note"]))
        named_addrs.add(0)

    # -- reg 5 packed SOC (low) / SOH (high) --
    if 5 in regs:
        soc, soh = regs[5] & 0xFF, regs[5] >> 8
        fields.append(Field(5, "State of charge (SOC)", soc, "%", CONFIRMED,
                            regs[5], "Battery", "low byte of reg5"))
        fields.append(Field(5, "State of health (SOH)", soh, "%", PROVISIONAL,
                            regs[5], "Battery", "high byte of reg5; scale unconfirmed"))
        named_addrs.add(5)

    # -- inverter serial (115..119) --
    serial = decode_serial(regs)
    if serial is not None:
        fields.append(Field(115, "Inverter serial", serial, "", CONFIRMED,
                            [regs.get(a) for a in SERIAL_REGS], "Identity",
                            "ASCII from regs 115..119"))
        named_addrs.update(SERIAL_REGS)

    # -- unmapped non-zero registers, surfaced as raw so nothing is hidden --
    for addr in range(0, 381):
        if addr in named_addrs:
            continue
        v = regs.get(addr)
        if v:  # non-zero and present
            fields.append(Field(addr, f"reg{addr} (unmapped)", v, "",
                                PROVISIONAL, v, "Unmapped (non-zero)",
                                "reads non-zero; meaning unknown"))

    # -- grouped view --
    groups: dict[str, list[Field]] = {}
    for f in fields:
        groups.setdefault(f.group, []).append(f)
    for g in groups:
        groups[g].sort(key=lambda x: x.addr)
    groups = {g: groups[g] for g in GROUP_ORDER if g in groups} | \
             {g: v for g, v in groups.items() if g not in GROUP_ORDER}

    by_addr: dict[int, Field] = {}
    for f in fields:
        by_addr.setdefault(f.addr, f)

    # -- derived health/summary values --
    cmax, cmin = regs.get(101), regs.get(102)
    delta = (cmax - cmin) if (cmax is not None and cmin is not None) else None
    derived = {
        "inverter_serial": serial,
        "soc_pct": (regs[5] & 0xFF) if 5 in regs else None,
        "soh_pct": (regs[5] >> 8) if 5 in regs else None,
        "cell_v_max_mV": cmax,
        "cell_v_min_mV": cmin,
        "cell_v_delta_mV": delta,      # health indicator (max-min)
        "cell_temp_max_C": round(_s16(regs[103]) * 0.1, 1) if 103 in regs else None,
        "cell_temp_min_C": round(_s16(regs[104]) * 0.1, 1) if 104 in regs else None,
        "battery_count": regs.get(96),
        "pack_capacity_Ah": regs.get(83),
        "bms_pack_current_A": round(_s16(regs[98]) * 0.1, 1) if 98 in regs else None,
        "cycle_count": regs.get(106),
        "runtime_s": (regs[69] | (regs[70] << 16)) if (69 in regs and 70 in regs) else None,
        "state": state,
    }

    # -- address-level coverage over the whole 0..380 space --
    coverage: dict[int, str] = {}
    named = reserved = unknown = 0
    for addr in range(0, 381):
        if addr in named_addrs:
            coverage[addr] = "named"
            named += 1
        elif regs.get(addr):
            coverage[addr] = "unknown"
            unknown += 1
        else:
            coverage[addr] = "reserved"
            reserved += 1

    return {
        "fields": fields,
        "groups": groups,
        "by_addr": by_addr,
        "derived": derived,
        "coverage": coverage,
        "counts": {"named": named, "reserved": reserved,
                   "unknown": unknown, "total": 381},
    }
