"""Config + options flow for the EG4 local dongle.

User flow (a menu):
  * "connect" — enter host / port / dongle serial / inverter serial. Validation
    actually opens the TCP session and harvests bank 0 via the vendored codec in
    the executor (bounded), so a wrong IP, a busy dongle, or wrong serials fail
    with a clear message instead of silently creating a dead entry.
  * "scan"    — bounded LuxPower discovery of the local /24 (see scanner.py):
    async, capped concurrency, short per-host timeout, whole scan under an
    overall ceiling, cleanly cancellable. Any hit pre-fills the connect form's
    host. Scanning is a convenience; the connect step never depends on it.

Options: poll interval (>= 30 s — the dongle is flaky) and whether to expose the
provisional BMS fields.
"""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback

from .const import (
    CONF_DONGLE_SERIAL,
    CONF_EXPOSE_PROVISIONAL,
    CONF_HOST,
    CONF_INVERTER_SERIAL,
    CONF_PORT,
    CONF_SCAN_INTERVAL,
    DEFAULT_EXPOSE_PROVISIONAL,
    DEFAULT_HOST,
    DEFAULT_PORT,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    MIN_SCAN_INTERVAL,
)
from . import scanner
from .validation import (
    CannotConnect,
    NoData,
    SerialMismatch,
    validate_connection,
)

_LOGGER = logging.getLogger(__name__)


class EG4LocalConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the EG4 local-dongle config flow."""

    VERSION = 1

    def __init__(self) -> None:
        self._prefill_host: str = DEFAULT_HOST
        self._scan_message: str | None = None

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Offer a menu: enter details, or scan for the dongle."""
        return self.async_show_menu(
            step_id="user",
            menu_options=["connect", "scan"],
        )

    async def async_step_connect(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Enter connection details and validate against the live dongle."""
        errors: dict[str, str] = {}
        description_placeholders: dict[str, str] = {}

        if user_input is not None:
            host = user_input[CONF_HOST].strip()
            port = int(user_input[CONF_PORT])
            dongle_sn = user_input[CONF_DONGLE_SERIAL].strip()
            inverter_sn = user_input[CONF_INVERTER_SERIAL].strip()
            try:
                confirmed_serial = await self.hass.async_add_executor_job(
                    validate_connection, host, port, dongle_sn, inverter_sn
                )
            except CannotConnect:
                errors["base"] = "cannot_connect"
            except NoData:
                errors["base"] = "no_data"
            except SerialMismatch as err:
                errors[CONF_INVERTER_SERIAL] = "serial_mismatch"
                description_placeholders["reported"] = err.reported
            except Exception:  # noqa: BLE001 - surface as generic, log the detail
                _LOGGER.exception("Unexpected error validating EG4 dongle")
                errors["base"] = "unknown"
            else:
                await self.async_set_unique_id(confirmed_serial)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=f"EG4 18kPV ({confirmed_serial})",
                    data={
                        CONF_HOST: host,
                        CONF_PORT: port,
                        CONF_DONGLE_SERIAL: dongle_sn,
                        CONF_INVERTER_SERIAL: inverter_sn,
                    },
                )

        defaults = user_input or {
            CONF_HOST: self._prefill_host,
            CONF_PORT: DEFAULT_PORT,
            CONF_DONGLE_SERIAL: "",
            CONF_INVERTER_SERIAL: "",
        }
        schema = vol.Schema(
            {
                vol.Required(CONF_HOST, default=defaults.get(CONF_HOST, DEFAULT_HOST)): str,
                vol.Required(CONF_PORT, default=defaults.get(CONF_PORT, DEFAULT_PORT)): int,
                vol.Required(CONF_DONGLE_SERIAL, default=defaults.get(CONF_DONGLE_SERIAL, "")): str,
                vol.Required(CONF_INVERTER_SERIAL, default=defaults.get(CONF_INVERTER_SERIAL, "")): str,
            }
        )
        # The connect description references {scan_result}; always supply it so
        # HA's string formatting never hits a missing placeholder.
        description_placeholders.setdefault("scan_result", self._scan_message or "")
        return self.async_show_form(
            step_id="connect",
            data_schema=schema,
            errors=errors,
            description_placeholders=description_placeholders,
        )

    async def async_step_scan(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Bounded discovery of the local /24; pre-fill host with any hit."""
        reference = await self.hass.async_add_executor_job(scanner.detect_local_ipv4)
        if not reference:
            reference = DEFAULT_HOST  # fall back to the default host's /24

        hits = await scanner.scan_subnet(reference)
        if hits:
            self._prefill_host = hits[0]
            self._scan_message = (
                f"Found {len(hits)} candidate dongle(s): {', '.join(hits)}. "
                f"Pre-filled host with {hits[0]}."
            )
        else:
            self._scan_message = (
                f"No dongle found on the {reference.rsplit('.', 1)[0]}.0/24 subnet. "
                "Enter the host manually."
            )
        return await self.async_step_connect()

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return EG4LocalOptionsFlow(config_entry)


class EG4LocalOptionsFlow(OptionsFlow):
    """Poll interval and provisional-field exposure."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        self._entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        options = self._entry.options
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_SCAN_INTERVAL,
                    default=options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
                ): vol.All(vol.Coerce(int), vol.Range(min=MIN_SCAN_INTERVAL, max=3600)),
                vol.Required(
                    CONF_EXPOSE_PROVISIONAL,
                    default=options.get(
                        CONF_EXPOSE_PROVISIONAL, DEFAULT_EXPOSE_PROVISIONAL
                    ),
                ): bool,
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
