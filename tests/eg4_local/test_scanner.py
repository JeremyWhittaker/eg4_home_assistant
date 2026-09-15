"""Network-scan helpers: subnet math + passive LuxPower detection over loopback."""
from __future__ import annotations

import asyncio

from _util import raises  # noqa: F401  (kept for parity; not all tests use it)

from eg4_local import scanner
from eg4_local.eg4_lib import protocol as P


def test_subnet_hosts_is_a_bounded_slash24():
    hosts = scanner.subnet_hosts("172.16.108.30")
    assert len(hosts) == 254                 # excludes .0 and .255
    assert "172.16.108.1" in hosts
    assert "172.16.108.30" in hosts
    assert "172.16.108.0" not in hosts
    assert "172.16.108.255" not in hosts


def test_detect_local_ipv4_sends_no_packets_and_returns_ip_or_none():
    ip = scanner.detect_local_ipv4()
    assert ip is None or ip.count(".") == 3


async def _serve_once(handler, delay=0.0):
    """Start a loopback server whose per-connection handler is ``handler``."""
    server = await asyncio.start_server(handler, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    return server, port


def test_probe_single_detects_luxpower_prefix():
    async def run():
        async def handler(reader, writer):
            # Emit the unsolicited A1 1A push a real dongle sends on connect.
            writer.write(P.PREFIX + b"\x01\x00\x06\x00")
            await writer.drain()
            await asyncio.sleep(0.05)
            writer.close()

        server, port = await _serve_once(handler)
        async with server:
            hit = await scanner.probe_single("127.0.0.1", port, timeout=1.0)
        return hit

    assert asyncio.run(run()) is True


def test_probe_single_rejects_silent_port():
    async def run():
        async def handler(reader, writer):
            # Accept but never send LuxPower framing.
            await asyncio.sleep(0.5)
            writer.close()

        server, port = await _serve_once(handler)
        async with server:
            hit = await scanner.probe_single("127.0.0.1", port, timeout=0.3)
        return hit

    assert asyncio.run(run()) is False


def test_probe_single_rejects_closed_port():
    async def run():
        # Nothing listening on this port -> connection refused -> False.
        return await scanner.probe_single("127.0.0.1", 1, timeout=0.5)

    assert asyncio.run(run()) is False
