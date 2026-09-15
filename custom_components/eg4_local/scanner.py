"""Bounded LuxPower-dongle discovery for the config flow — no HA imports.

How the scan is bounded (a convenience, never required):
  * Scope is a single /24 — the Home Assistant host's own subnet when it can be
    detected, else the /24 of the user's default/entered host. 254 hosts, no
    wider.
  * Concurrency is capped by a semaphore (``SCAN_CONCURRENCY``), so at most a few
    dozen sockets are open at once.
  * Each host gets a short timeout (``SCAN_PER_HOST_TIMEOUT``); the whole scan is
    additionally capped by ``SCAN_TOTAL_TIMEOUT``.
  * The whole thing is one ``asyncio.gather`` under ``asyncio.wait_for`` — if the
    user backs out of the config-flow step the task is cancelled cleanly.

Detection is PASSIVE: the LuxPower/EG4 dongle, once a TCP client connects on
:8000, immediately PUSHES unsolicited frames (heartbeats and input-register
banks) that begin with the ``A1 1A`` prefix. A passive listener therefore needs
no dongle/inverter serial to identify a dongle — it just watches for that frame
prefix. (Building a valid input-read poke would require the serials we do not
yet have at scan time, so passive detection is both simpler and serial-free.)
"""
from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import socket

from .const import (
    SCAN_CONCURRENCY,
    SCAN_PER_HOST_TIMEOUT,
    SCAN_PORT,
    SCAN_TOTAL_TIMEOUT,
)
from .eg4_lib import protocol as P


def detect_local_ipv4() -> str | None:
    """Best-effort primary IPv4 of this host. Sends no packets.

    UDP-connecting a datagram socket only fixes a destination and lets the OS
    pick the source address from its routing table; nothing is transmitted, so
    this works even with no external connectivity.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def subnet_hosts(reference_ip: str) -> list[str]:
    """All host addresses of the /24 containing ``reference_ip`` (excl. net/bcast)."""
    net = ipaddress.ip_network(f"{reference_ip}/24", strict=False)
    return [str(ip) for ip in net.hosts()]


async def _probe_host(host: str, port: int, timeout: float) -> str | None:
    """Return ``host`` if a LuxPower frame prefix is seen within ``timeout``, else None."""
    reader = writer = None
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=timeout
        )
        # Passively wait for the dongle's unsolicited push; look for A1 1A.
        buf = b""
        deadline = asyncio.get_running_loop().time() + timeout
        while asyncio.get_running_loop().time() < deadline:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            try:
                chunk = await asyncio.wait_for(reader.read(256), timeout=remaining)
            except asyncio.TimeoutError:
                break
            if not chunk:
                break
            buf += chunk
            if P.PREFIX in buf:
                return host
        return None
    except (OSError, asyncio.TimeoutError):
        return None
    finally:
        if writer is not None:
            with contextlib.suppress(OSError):
                writer.close()
            with contextlib.suppress(OSError, asyncio.TimeoutError):
                await asyncio.wait_for(writer.wait_closed(), timeout=1.0)


async def scan_subnet(
    reference_ip: str,
    port: int = SCAN_PORT,
    concurrency: int = SCAN_CONCURRENCY,
    per_host_timeout: float = SCAN_PER_HOST_TIMEOUT,
    total_timeout: float = SCAN_TOTAL_TIMEOUT,
) -> list[str]:
    """Scan the /24 around ``reference_ip`` for dongles. Returns hits (sorted)."""
    hosts = subnet_hosts(reference_ip)
    sem = asyncio.Semaphore(concurrency)

    async def guarded(h: str) -> str | None:
        async with sem:
            return await _probe_host(h, port, per_host_timeout)

    async def run() -> list[str]:
        results = await asyncio.gather(*(guarded(h) for h in hosts))
        return sorted(r for r in results if r)

    try:
        return await asyncio.wait_for(run(), timeout=total_timeout)
    except asyncio.TimeoutError:
        return []


async def probe_single(host: str, port: int = SCAN_PORT,
                       timeout: float = SCAN_PER_HOST_TIMEOUT) -> bool:
    """'Test this IP': is a LuxPower dongle answering at ``host:port``?"""
    return (await _probe_host(host, port, timeout)) is not None
