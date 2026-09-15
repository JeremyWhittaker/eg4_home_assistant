# ─────────────────────────────────────────────────────────────────────────
# VENDORED from eg4_local_monitor  (package: eg4_dongle/protocol.py)
# Source of truth: github JeremyWhittaker/eg4_local_monitor @ a0aadee1a3e3a171665fcd61e4428188108969ec
# Do NOT edit the protocol framing, validated register scales, or the
# confidence flags here — fix them upstream in eg4_local_monitor and re-vendor.
# Vendored 2026-09-15 for the eg4_local Home Assistant integration (stdlib only).
# ─────────────────────────────────────────────────────────────────────────
"""LuxPower / EG4 dongle TCP protocol codec.

The EG4/LuxPower WiFi dongle speaks a framed protocol on TCP/8000. It behaves as
if the connecting client is the LuxPower cloud server: it PUSHES input-register
banks unsolicited, sends periodic heartbeats it expects echoed, and answers
read/write requests that wrap Modbus over its RS-485 link to the inverter.

Frame (all multi-byte little-endian)::

    A1 1A | proto:2 | frame_len:2 | addr:1 | tcp_fn:1 | dongle_sn:10 | data_len:2 | data

`frame_len` counts every byte after itself, i.e. total_len - 6. The trailing CRC
lives inside `data`, not the outer frame.

Data frame::

    request:  addr:1 | dev_fn:1 | inverter_sn:10 | start:2 | count:2      | crc16:2
    response: addr:1 | dev_fn:1 | inverter_sn:10 | start:2 | nbytes:1 | values | crc16:2

tcp_fn: 0xC1 heartbeat, 0xC2 translated-data (register read/write).
dev_fn: 0x03 read hold, 0x04 read input, 0x06 write-single, 0x10 write-multi.

Established live against dongle BA32401949 / inverter 3352670252 on 2026-09-15.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass

PREFIX = b"\xa1\x1a"
TCP_HEARTBEAT = 0xC1
TCP_TRANSLATED = 0xC2
TCP_READ_PARAM = 0xC3       # LuxPower ReadParam: dongle/config params, no inverter-SN/CRC
TCP_WRITE_PARAM = 0xC4      # LuxPower WriteParam (not used for read-only probing)
DEV_READ_HOLD = 0x03
DEV_READ_INPUT = 0x04


def crc16_modbus(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if (crc & 1) else (crc >> 1)
    return crc


@dataclass(slots=True)
class Frame:
    proto: int
    tcp_fn: int
    dongle_sn: str
    dev_fn: int | None
    inverter_sn: str | None
    start: int | None
    values: list[int] | None       # decoded uint16 registers (responses only)
    raw: bytes
    crc_ok: bool


def build_request(dongle_sn: bytes, inverter_sn: bytes, dev_fn: int,
                  start: int, count: int, proto: int = 1) -> bytes:
    data = bytes([0x00, dev_fn]) + inverter_sn + struct.pack("<HH", start, count)
    data += struct.pack("<H", crc16_modbus(data))
    body = bytes([0x01, TCP_TRANSLATED]) + dongle_sn + struct.pack("<H", len(data)) + data
    return PREFIX + struct.pack("<H", proto) + struct.pack("<H", len(body) + 2) + body


def build_read_param(dongle_sn: bytes, register: int, proto: int = 1) -> bytes:
    """Build a LuxPower ReadParam (tcp_fn=0xC3) request.

    ReadParam targets the datalog/dongle's own parameter store rather than the
    inverter over RS-485, so — unlike a translated read — the data section carries
    NO inverter serial and NO Modbus CRC, only the 2-byte register selector. This
    is exploratory: some firmwares serve dongle/config params here, others ignore
    it. The response framing is captured and hexdumped by params.py.
    """
    data = struct.pack("<H", register)
    body = bytes([0x01, TCP_READ_PARAM]) + dongle_sn + struct.pack("<H", len(data)) + data
    return PREFIX + struct.pack("<H", proto) + struct.pack("<H", len(body) + 2) + body


def try_parse(buf: bytes) -> tuple[Frame | None, bytes]:
    """Parse one frame from the front of buf. Returns (frame_or_None, remaining)."""
    i = buf.find(PREFIX)
    if i < 0:
        # No full prefix yet. Preserve a trailing lone 0xA1 in case the second
        # prefix byte (0x1A) arrives in the next recv — otherwise a frame that
        # straddles a recv boundary is silently corrupted.
        return None, buf[-1:] if buf[-1:] == PREFIX[:1] else b""
    buf = buf[i:]
    if len(buf) < 6:
        return None, buf
    frame_len = int.from_bytes(buf[4:6], "little")
    total = frame_len + 6
    if len(buf) < total:
        return None, buf
    f = buf[:total]
    rest = buf[total:]
    proto = int.from_bytes(f[2:4], "little")
    tcp_fn = f[7]
    dongle_sn = f[8:18].decode("latin1", "replace").rstrip("\x00")
    dev_fn = inv_sn = start = values = None
    crc_ok = True
    if tcp_fn == TCP_TRANSLATED and len(f) >= 20:
        dlen = int.from_bytes(f[18:20], "little")
        data = f[20:20 + dlen]
        if len(data) >= 15:
            dev_fn = data[1]
            inv_sn = data[2:12].decode("latin1", "replace").rstrip("\x00")
            start = int.from_bytes(data[12:14], "little")
            nbytes = data[14]
            body = data[15:15 + nbytes]
            if len(body) == nbytes and 15 + nbytes + 2 <= len(data):
                got = int.from_bytes(data[15 + nbytes:15 + nbytes + 2], "little")
                crc_ok = got == crc16_modbus(data[:15 + nbytes])
                values = [int.from_bytes(body[2 * k:2 * k + 2], "little") for k in range(nbytes // 2)]
    return Frame(proto, tcp_fn, dongle_sn, dev_fn, inv_sn, start, values, f, crc_ok), rest
