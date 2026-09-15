"""Config-flow validation logic, with the dongle connection mocked."""
from __future__ import annotations

from types import SimpleNamespace

from _util import load_regs, raises

from eg4_local import validation as V


class _FakeDongle:
    """Stand-in for eg4_lib.EG4Dongle injected via client_factory."""

    def __init__(self, host, port, dongle_sn, inverter_sn, *,
                 connect_error=False, read_error=False, regs=None, bank0=True):
        self._connect_error = connect_error
        self._read_error = read_error
        self._regs = regs if regs is not None else {}
        self.last_harvest = SimpleNamespace(banks={0: bank0}, complete=bank0)

    def connect(self):
        if self._connect_error:
            raise OSError("connection refused")

    def read_input_all(self, timeout=45.0):
        if self._read_error:
            raise OSError("socket dropped")
        return self._regs

    def close(self):
        pass


def _factory(**kw):
    return lambda *a: _FakeDongle(*a, **kw)


def test_validate_success_returns_serial():
    serial = V.validate_connection(
        "172.16.108.30", 8000, "BA32401949", "3352670252",
        client_factory=_factory(regs=load_regs(), bank0=True),
    )
    assert serial == "3352670252"


def test_cannot_connect_on_connect_failure():
    with raises(V.CannotConnect):
        V.validate_connection(
            "10.0.0.9", 8000, "BA32401949", "3352670252",
            client_factory=_factory(connect_error=True),
        )


def test_cannot_connect_on_read_failure():
    with raises(V.CannotConnect):
        V.validate_connection(
            "172.16.108.30", 8000, "BA32401949", "3352670252",
            client_factory=_factory(read_error=True),
        )


def test_no_data_when_bank0_absent():
    with raises(V.NoData):
        V.validate_connection(
            "172.16.108.30", 8000, "BA32401949", "3352670252",
            client_factory=_factory(regs={}, bank0=False),
        )


def test_serial_mismatch_reports_actual_serial():
    try:
        V.validate_connection(
            "172.16.108.30", 8000, "BA32401949", "9999999999",
            client_factory=_factory(regs=load_regs(), bank0=True),
        )
    except V.SerialMismatch as err:
        assert err.reported == "3352670252"
    else:
        raise AssertionError("expected SerialMismatch")
