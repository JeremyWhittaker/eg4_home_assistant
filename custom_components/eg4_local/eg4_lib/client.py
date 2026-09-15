# ─────────────────────────────────────────────────────────────────────────
# VENDORED from eg4_local_monitor  (package: eg4_dongle/client.py)
# Source of truth: github JeremyWhittaker/eg4_local_monitor @ a0aadee1a3e3a171665fcd61e4428188108969ec
# Do NOT edit the protocol framing, validated register scales, or the
# confidence flags here — fix them upstream in eg4_local_monitor and re-vendor.
# Vendored 2026-09-15 for the eg4_local Home Assistant integration (stdlib only).
# ─────────────────────────────────────────────────────────────────────────
"""Robust EG4 dongle client: one reader loop, heartbeat replies, serialized reads.

The dongle interleaves unsolicited input-bank pushes with heartbeats and answers
requests slowly (it polls the inverter over RS-485 per request). One-shot probes
race that; this keeps a single connection, echoes heartbeats, collects the
unsolicited input pushes for free, and issues one request at a time, waiting
patiently and retrying, so full-register extraction is reliable.

Reliability model
-----------------
Input registers arrive in three native banks — 0..126, 127..253, 254..380 (127
regs each, 381 total). While the dongle is polling the inverter over RS-485 it
answers banks INCONSISTENTLY: a poll for the full set frequently returns only
bank 0. ``read_input_all`` re-pokes only the banks still missing on a fixed
cadence, keeps echoing heartbeats, survives the dongle dropping the socket
mid-harvest (bounded reconnect, accumulated registers are preserved), and either
returns a complete 381-register map or records exactly which banks it could not
get. Nothing half-empty is ever returned as if it were complete: inspect
``last_harvest`` or call ``read_input_all_or_raise``.
"""
from __future__ import annotations

import contextlib
import socket
import time
from dataclasses import dataclass

from . import protocol as P

# Native input banks: (start, count). 0..126, 127..253, 254..380 = 381 regs.
INPUT_BANKS: tuple[tuple[int, int], ...] = ((0, 127), (127, 127), (254, 127))
INPUT_SPAN = INPUT_BANKS[-1][0] + INPUT_BANKS[-1][1]   # 381


@dataclass(slots=True)
class HarvestResult:
    """Honest outcome of one ``read_input_all`` call."""
    complete: bool
    register_count: int
    banks: dict[int, bool]          # bank-start -> fully populated?
    missing_banks: list[int]        # bank-starts not fully populated
    missing_count: int              # individual addresses still absent
    elapsed: float                  # seconds
    reconnects: int
    heartbeats: int

    def summary(self) -> str:
        state = "COMPLETE" if self.complete else "INCOMPLETE"
        b = ",".join(f"{s}:{'ok' if ok else 'MISSING'}" for s, ok in sorted(self.banks.items()))
        return (f"{state} {self.register_count}/{INPUT_SPAN} regs in {self.elapsed:.1f}s "
                f"(banks {b}; {self.reconnects} reconnect(s), {self.heartbeats} hb)")


class IncompleteHarvest(RuntimeError):
    """Raised by read_input_all_or_raise when not all banks landed in time."""
    def __init__(self, result: HarvestResult):
        self.result = result
        super().__init__(result.summary())


class EG4Dongle:
    def __init__(self, host: str, port: int, dongle_sn: str, inverter_sn: str,
                 timeout: float = 12.0, max_reconnects: int = 3):
        self.host, self.port = host, port
        self.dongle_sn = dongle_sn.encode()
        self.inverter_sn = inverter_sn.encode()
        self.timeout = timeout
        self.max_reconnects = max_reconnects
        self._sock: socket.socket | None = None
        self._buf = b""
        self._closed = False
        # everything we have ever seen, register-address -> raw uint16
        self.input_regs: dict[int, int] = {}
        self.hold_regs: dict[int, int] = {}
        self.heartbeats = 0
        self.last_harvest: HarvestResult | None = None

    # ------------------------------------------------------------------ socket
    def connect(self):
        self._sock = socket.create_connection((self.host, self.port), timeout=8)
        self._sock.settimeout(0.5)
        self._buf = b""
        self._closed = False

    def close(self):
        if self._sock:
            with contextlib.suppress(OSError):
                self._sock.close()
            self._sock = None

    def _ensure_connected(self):
        if self._sock is None or self._closed:
            self.connect()

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *a):
        self.close()

    # -------------------------------------------------------------------- pump
    def _pump(self, deadline: float):
        """Read until ``deadline``, storing register frames and echoing heartbeats.

        Robust to (a) frames split across recv boundaries — try_parse holds a
        partial frame, and a lone trailing 0xA1 prefix byte, in ``self._buf`` —
        and (b) the dongle closing the socket, which surfaces as an empty recv or
        an OS error; either sets ``self._closed`` and returns without raising.
        A bare socket timeout is NOT the end of data: keep waiting until deadline.
        """
        if self._sock is None:
            self._closed = True
            return
        while time.time() < deadline:
            try:
                d = self._sock.recv(8192)
            except TimeoutError:
                continue            # idle gap, not EOF — keep waiting
            except OSError:
                self._closed = True
                return
            if not d:
                self._closed = True   # dongle hung up
                return
            self._buf += d
            while True:
                frame, self._buf = P.try_parse(self._buf)
                if frame is None:
                    break
                self._handle_frame(frame)

    def _handle_frame(self, frame: P.Frame):
        if frame.tcp_fn == P.TCP_HEARTBEAT:
            try:
                self._sock.send(frame.raw)   # echo keeps the session alive
            except OSError:
                self._closed = True
            self.heartbeats += 1
        elif frame.values is not None and frame.crc_ok:
            tgt = self.input_regs if frame.dev_fn == P.DEV_READ_INPUT else self.hold_regs
            for k, v in enumerate(frame.values):
                tgt[frame.start + k] = v

    def _send(self, payload: bytes) -> bool:
        try:
            self._sock.send(payload)
            return True
        except OSError:
            self._closed = True
            return False

    # ----------------------------------------------------------- input harvest
    def _bank_complete(self, start: int, count: int) -> bool:
        regs = self.input_regs
        return all((start + i) in regs for i in range(count))

    def _make_result(self, elapsed: float, reconnects: int) -> HarvestResult:
        banks = {s: self._bank_complete(s, c) for s, c in INPUT_BANKS}
        missing_banks = [s for s, ok in banks.items() if not ok]
        present = sum(1 for a in range(INPUT_SPAN) if a in self.input_regs)
        return HarvestResult(
            complete=not missing_banks,
            register_count=len(self.input_regs),
            banks=banks,
            missing_banks=sorted(missing_banks),
            missing_count=INPUT_SPAN - present,
            elapsed=elapsed,
            reconnects=reconnects,
            heartbeats=self.heartbeats,
        )

    def read_input_all(self, timeout: float = 45.0, poke_interval: float = 5.0,
                       settle: float = 0.6, stall_reconnect: float = 0.0,
                       reconnect_cooldown: float = 2.0) -> dict[int, int]:
        """Harvest all three native input banks (0..380) as reliably as the dongle allows.

        Device reality (measured live, 2026-09-15): the full three-bank set arrives
        as a burst shortly after connect, then the dongle reverts to streaming only
        bank 0 (0..126). Whether that burst includes the deprioritised high banks
        (127..253, 254..380 — the mostly-empty 2nd-inverter / 2nd-battery slots) is a
        per-connection lottery: measured 3/5 full-set success, ~20 s when it lands.
        A session that starts in bank-0-only mode STAYS that way — neither pokes nor
        reconnecting rescued it in testing (failed runs reconnected 3x and still never
        got bank 254). Bank 0, which carries ALL live telemetry and the entire BMS /
        cell block (regs 80..126), landed on every session observed.

        This method pokes the still-missing banks every ``poke_interval`` seconds and
        pumps (echoing heartbeats) in between, reconnecting if the dongle drops the
        socket (accumulated registers persist across a reconnect). ``stall_reconnect``
        (seconds without new data before a proactive reconnect) is OFF by default:
        measured not to help this dongle's high-bank lottery and it adds connection
        churn — set it >0 only to opt in. ``max_reconnects`` bounds all reconnects.

        Returns a snapshot dict of every input register seen (possibly partial on
        timeout). Records the honest outcome on ``self.last_harvest`` — check
        ``.complete`` / ``.missing_banks`` (and per-bank ``.banks``) before trusting a
        partial result, or use ``read_input_all_or_raise``.
        """
        self._ensure_connected()
        t0 = time.time()
        deadline = t0 + timeout
        reconnects = 0
        last_poke = t0 - poke_interval        # poke immediately on the first pass
        last_progress = t0
        best_present = -1
        while time.time() < deadline:
            present = sum(1 for a in range(INPUT_SPAN) if a in self.input_regs)
            if present > best_present:          # a genuinely new bank/register landed
                best_present = present
                last_progress = time.time()
            stalled = stall_reconnect and (time.time() - last_progress) >= stall_reconnect
            if self._closed or stalled:
                if reconnects >= self.max_reconnects:
                    if self._closed:
                        break
                    stall_reconnect = 0         # budget spent; wait out the rest patiently
                elif (deadline - time.time()) > settle * 4:
                    reconnects += 1
                    self.close()
                    time.sleep(min(reconnect_cooldown, max(0.0, deadline - time.time())))
                    try:
                        self.connect()
                    except OSError:
                        time.sleep(1.0)
                        continue
                    last_poke = time.time() - poke_interval
                    last_progress = time.time()
            missing = [b for b in INPUT_BANKS if not self._bank_complete(*b)]
            if not missing:
                break
            now = time.time()
            if now - last_poke >= poke_interval:
                for start, count in missing:
                    if not self._send(P.build_request(self.dongle_sn, self.inverter_sn,
                                                       P.DEV_READ_INPUT, start, count)):
                        break
                last_poke = now
            self._pump(min(deadline, time.time() + settle))
        self.last_harvest = self._make_result(time.time() - t0, reconnects)
        return dict(self.input_regs)

    def read_input_all_or_raise(self, timeout: float = 45.0, **kw) -> dict[int, int]:
        """Like read_input_all but raise IncompleteHarvest if any bank is missing."""
        regs = self.read_input_all(timeout=timeout, **kw)
        assert self.last_harvest is not None
        if not self.last_harvest.complete:
            raise IncompleteHarvest(self.last_harvest)
        return regs

    # ---------------------------------------------------- legacy / passive API
    def collect_pushed_input(self, seconds: float = 16.0):
        """Passively harvest the unsolicited input-bank pushes (0..~380)."""
        self._ensure_connected()
        self._pump(time.time() + seconds)

    def read(self, dev_fn: int, start: int, count: int, attempts: int = 4) -> bool:
        """Issue one read and wait for its bank to fill. Retries; returns success."""
        self._ensure_connected()
        tgt = self.input_regs if dev_fn == P.DEV_READ_INPUT else self.hold_regs
        for _ in range(attempts):
            if not self._send(P.build_request(self.dongle_sn, self.inverter_sn,
                                              dev_fn, start, count)):
                break
            end = time.time() + 4.0
            while time.time() < end:
                self._pump(time.time() + 0.8)
                if all((start + i) in tgt for i in range(count)):
                    return True
            time.sleep(0.3)
        return all((start + i) in tgt for i in range(count))

    def read_all_hold(self, span: int = 240, bank: int = 40) -> int:
        for start in range(0, span, bank):
            self.read(P.DEV_READ_HOLD, start, bank)
        return len(self.hold_regs)

    def read_all_input(self, span: int = 200, bank: int = 40) -> int:
        for start in range(0, span, bank):
            self.read(P.DEV_READ_INPUT, start, bank)
        return len(self.input_regs)
