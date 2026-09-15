"""Constants for the EG4 local-dongle integration."""
from __future__ import annotations

DOMAIN = "eg4_local"

# Config-entry keys.
CONF_HOST = "host"
CONF_PORT = "port"
CONF_DONGLE_SERIAL = "dongle_serial"
CONF_INVERTER_SERIAL = "inverter_serial"

# Options keys.
CONF_SCAN_INTERVAL = "scan_interval"
CONF_EXPOSE_PROVISIONAL = "expose_provisional"

# Defaults. The reserved IP is this device's DHCP reservation (it moves on lease
# renewal, so it is only a default the user can override — never the sole source).
DEFAULT_HOST = "172.16.108.30"
DEFAULT_PORT = 8000
DEFAULT_SCAN_INTERVAL = 60          # seconds
MIN_SCAN_INTERVAL = 30              # the dongle is flaky; do not poll harder
DEFAULT_EXPOSE_PROVISIONAL = True

# Per-poll harvest budget (must stay comfortably under the scan interval).
HARVEST_TIMEOUT = 25.0             # seconds
CONNECT_TIMEOUT = 8.0             # seconds, used during config-flow validation

# Network-scan bounds (config-flow convenience).
SCAN_PORT = DEFAULT_PORT
SCAN_CONCURRENCY = 40             # cap simultaneous probes
SCAN_PER_HOST_TIMEOUT = 1.5      # seconds to wait for a LuxPower frame per host
SCAN_TOTAL_TIMEOUT = 40.0        # overall scan ceiling

DEVICE_NAME = "EG4 18kPV (local dongle)"
MANUFACTURER = "EG4 Electronics"
MODEL = "18kPV (local dongle)"
