const ENERGY_COLLECTION = "energy_eg4";

function noControlActions() {
  return {
    tap_action: { action: "more-info" },
    hold_action: { action: "none" },
    icon_tap_action: { action: "more-info" },
  };
}

function tile(entity, name, icon, columns = 6) {
  return {
    type: "tile",
    entity,
    name,
    icon,
    vertical: true,
    state_content: ["state", "last_updated"],
    grid_options: { columns, rows: 2 },
    ...noControlActions(),
  };
}

function heading(text, icon, style = "title") {
  return { type: "heading", heading: text, heading_style: style, icon };
}

function entityRow(entity, name, icon) {
  return { entity, name, ...(icon ? { icon } : {}) };
}

function liveSummary(entities) {
  const e = entities;
  return `{% set unavailable = ['unknown', 'unavailable', 'none', ''] %}
{% set pv_raw = states('${e.pvPower}') %}
{% set load_raw = states('${e.loadPower}') %}
{% set import_raw = states('${e.gridImportPower}') %}
{% set export_raw = states('${e.gridExportPower}') %}
{% set battery_raw = states('${e.batteryPower}') %}
{% set soc_raw = states('${e.batteryBankSoc}') %}
{% set telemetry_ok = pv_raw | lower not in unavailable and load_raw | lower not in unavailable and import_raw | lower not in unavailable and export_raw | lower not in unavailable and battery_raw | lower not in unavailable and soc_raw | lower not in unavailable %}
{% set connection_ok = states('${e.connectionLost}') | lower in ['false', 'off'] and states('${e.runtimeData}') | lower in ['true', 'on'] %}
{% if not telemetry_ok or not connection_ok %}
## ⚠️ Telemetry needs attention
One or more live readings are unavailable. Values below are left unavailable—not treated as zero. **Connection:** {{ states('${e.transport}') }} · **Cloud:** {{ states('${e.cloudStatus}') }}
{% else %}
{% set pv = pv_raw | float %}
{% set load = load_raw | float %}
{% set imported = import_raw | float %}
{% set exported = export_raw | float %}
{% set battery = battery_raw | float %}
{% set soc = soc_raw | float %}
{% if is_state('${e.offGrid}', 'on') %}
## 🏝️ Operating off-grid
{% else %}
## ☀️ Solar system online
{% endif %}
Producing **{{ (pv / 1000) | round(1) }} kW** with **{{ (load / 1000) | round(1) }} kW** on EG4's metered AC balance. This is an equipment reading, not the whole-property load; use **Home Energy** for the Enphase-corrected total.
{% if exported > 50 %}Exporting **{{ (exported / 1000) | round(1) }} kW** to the grid.{% elif imported > 50 %}Importing **{{ (imported / 1000) | round(1) }} kW** from the grid.{% else %}Grid exchange is effectively neutral.{% endif %}
Battery is **{{ soc | round(0) }}%** and {% if battery > 50 %}charging at **{{ (battery / 1000) | round(1) }} kW**{% elif battery < -50 %}discharging at **{{ ((battery | abs) / 1000) | round(1) }} kW**{% else %}standing by{% endif %}. · **Mode:** {{ state_translated('${e.operatingState}') }}
{% endif %}`;
}

function missingTelemetryCard(e) {
  return {
    type: "entity-filter",
    state_filter: ["unknown", "unavailable"],
    show_empty: false,
    entities: [
      entityRow(e.pvPower, "Solar production"),
      entityRow(e.loadPower, "EG4 metered load"),
      entityRow(e.gridImportPower, "Grid import"),
      entityRow(e.gridExportPower, "Grid export"),
      entityRow(e.batteryPower, "Battery power"),
      entityRow(e.batteryBankSoc, "Battery state of charge"),
      entityRow(e.runtimeData, "Runtime data"),
    ],
    card: {
      type: "entities",
      title: "Unavailable telemetry",
      show_header_toggle: false,
      state_color: true,
    },
    grid_options: { columns: "full" },
  };
}

export function buildDashboard(discovery) {
  const e = discovery.entities;
  return {
    views: [
      {
        title: "Live",
        path: "live",
        icon: "mdi:solar-power",
        type: "sections",
        max_columns: 2,
        dense_section_placement: true,
        badges: [
          { type: "entity", entity: e.pvPower, name: "Solar", icon: "mdi:solar-power", ...noControlActions() },
          { type: "entity", entity: e.loadPower, name: "Home", icon: "mdi:home-lightning-bolt", ...noControlActions() },
          { type: "entity", entity: e.batteryBankSoc, name: "Battery", icon: "mdi:home-battery", ...noControlActions() },
          { type: "entity", entity: e.operatingState, name: "Mode", icon: "mdi:state-machine", ...noControlActions() },
        ],
        sections: [
          {
            type: "grid",
            cards: [
              heading("Live energy flow", "mdi:transmission-tower-import"),
              {
                type: "markdown",
                content: liveSummary(e),
                grid_options: { columns: "full" },
              },
              missingTelemetryCard(e),
              {
                type: "distribution",
                title: "Current power readings",
                entities: [
                  { entity: e.pvPower, name: "Solar production", color: "#f9a825" },
                  { entity: e.loadPower, name: "EG4 metered load", color: "#1e88e5" },
                  { entity: e.gridImportPower, name: "Grid import", color: "#7e57c2" },
                  { entity: e.gridExportPower, name: "Grid export", color: "#8e24aa" },
                  { entity: e.batteryPower, name: "Battery (+ charge / − discharge)", color: "#00897b" },
                ],
                grid_options: { columns: "full" },
              },
              heading("Primary power", "mdi:flash", "subtitle"),
              tile(e.pvPower, "Solar production", "mdi:solar-power"),
              tile(e.loadPower, "EG4 metered load", "mdi:meter-electric-outline"),
              tile(e.gridImportPower, "Grid import", "mdi:transmission-tower-import"),
              tile(e.gridExportPower, "Grid export", "mdi:transmission-tower-export"),
            ],
          },
          {
            type: "grid",
            cards: [
              heading("Battery", "mdi:home-battery"),
              {
                type: "gauge",
                entity: e.batteryBankSoc,
                name: "State of charge",
                min: 0,
                max: 100,
                needle: true,
                severity: { red: 0, yellow: 20, green: 50 },
                grid_options: { columns: "full", rows: 3 },
              },
              tile(e.batteryPower, "Battery power (+ charge / − discharge)", "mdi:battery-charging", 6),
              tile(e.batteryBankStatus, "Battery status", "mdi:battery-heart", 6),
              heading("Today", "mdi:calendar-today", "subtitle"),
              tile(e.yieldToday, "Solar generated", "mdi:white-balance-sunny", 6),
              tile(e.consumptionToday, "EG4 metered consumption", "mdi:meter-electric-outline", 6),
              tile(e.gridImportToday, "Imported", "mdi:transmission-tower-import", 6),
              tile(e.gridExportToday, "Exported", "mdi:transmission-tower-export", 6),
              heading("Last 24 hours", "mdi:chart-areaspline", "subtitle"),
              {
                type: "history-graph",
                title: "Power history",
                hours_to_show: 24,
                entities: [
                  entityRow(e.pvPower, "Solar"),
                  entityRow(e.loadPower, "EG4 metered load"),
                  entityRow(e.gridImportPower, "Grid import"),
                  entityRow(e.gridExportPower, "Grid export"),
                  entityRow(e.batteryPower, "Battery (+ charge / − discharge)"),
                ],
                grid_options: { columns: "full", rows: 6 },
              },
            ],
          },
        ],
      },
      {
        title: "Energy",
        path: "energy",
        icon: "mdi:chart-sankey-variant",
        type: "sections",
        max_columns: 2,
        dense_section_placement: true,
        sections: [
          {
            type: "grid",
            cards: [
              heading("Energy balance", "mdi:chart-donut"),
              { type: "energy-date-selection", collection_key: ENERGY_COLLECTION, grid_options: { columns: "full" } },
              { type: "energy-distribution", title: "Where energy flowed", collection_key: ENERGY_COLLECTION, link_dashboard: false, grid_options: { columns: "full", rows: 5 } },
              { type: "energy-grid-balance", collection_key: ENERGY_COLLECTION, grid_options: { columns: 6, rows: 3 } },
              { type: "energy-self-sufficiency-gauge", collection_key: ENERGY_COLLECTION, grid_options: { columns: 6, rows: 3 } },
              { type: "energy-solar-consumed-gauge", collection_key: ENERGY_COLLECTION, grid_options: { columns: "full", rows: 3 } },
            ],
          },
          {
            type: "grid",
            cards: [
              heading("Production and use", "mdi:chart-areaspline"),
              { type: "energy-usage-graph", title: "Home energy", collection_key: ENERGY_COLLECTION, show_legend: false, grid_options: { columns: "full", rows: 6 } },
              { type: "energy-solar-graph", title: "Solar production", collection_key: ENERGY_COLLECTION, grid_options: { columns: "full", rows: 6 } },
              {
                type: "history-graph",
                title: "Today's power detail",
                hours_to_show: 24,
                entities: [
                  entityRow(e.pvPower, "Solar"),
                  entityRow(e.loadPower, "EG4 metered load"),
                  entityRow(e.gridImportPower, "Grid import"),
                  entityRow(e.gridExportPower, "Grid export"),
                  entityRow(e.batteryPower, "Battery (+ charge / − discharge)"),
                ],
                grid_options: { columns: "full", rows: 6 },
              },
            ],
          },
          {
            type: "grid",
            cards: [
              heading("Flow detail", "mdi:chart-sankey"),
              { type: "energy-sankey", title: "Energy flow", collection_key: ENERGY_COLLECTION, layout: "auto", group_by_area: false, group_by_floor: false, grid_options: { columns: "full", rows: 7 } },
            ],
          },
          {
            type: "grid",
            cards: [
              heading("Lifetime totals", "mdi:counter"),
              {
                type: "entities",
                title: "Lifetime energy",
                show_header_toggle: false,
                entities: [
                  entityRow(e.yieldLifetime, "Solar generated", "mdi:solar-power"),
                  entityRow(e.consumptionLifetime, "EG4 metered consumption", "mdi:meter-electric-outline"),
                  entityRow(e.gridImportLifetime, "Grid imported", "mdi:transmission-tower-import"),
                  entityRow(e.gridExportLifetime, "Grid exported", "mdi:transmission-tower-export"),
                  entityRow(e.chargingLifetime, "Battery charged", "mdi:battery-arrow-up"),
                  entityRow(e.dischargingLifetime, "Battery discharged", "mdi:battery-arrow-down"),
                ],
                grid_options: { columns: "full" },
              },
            ],
          },
        ],
      },
      {
        title: "Performance",
        path: "performance",
        icon: "mdi:chart-line",
        type: "sections",
        max_columns: 2,
        dense_section_placement: true,
        sections: [
          {
            type: "grid",
            cards: [
              heading("Power", "mdi:flash"),
              {
                type: "history-graph",
                title: "Power · 48 hours",
                hours_to_show: 48,
                entities: [
                  entityRow(e.pvPower, "Solar"),
                  entityRow(e.loadPower, "EG4 metered load"),
                  entityRow(e.gridImportPower, "Grid import"),
                  entityRow(e.gridExportPower, "Grid export"),
                  entityRow(e.batteryPower, "Battery"),
                ],
                grid_options: { columns: "full", rows: 7 },
              },
              {
                type: "statistics-graph",
                title: "Daily energy · 30 days",
                entities: [
                  entityRow(e.yieldLifetime, "Solar generated"),
                  entityRow(e.consumptionLifetime, "EG4 metered consumption"),
                  entityRow(e.gridImportLifetime, "Grid import"),
                  entityRow(e.gridExportLifetime, "Grid export"),
                ],
                stat_types: ["change"],
                period: "day",
                days_to_show: 30,
                chart_type: "bar",
                hide_legend: false,
                grid_options: { columns: "full", rows: 7 },
              },
            ],
          },
          {
            type: "grid",
            cards: [
              heading("PV arrays", "mdi:solar-panel-large"),
              {
                type: "distribution",
                title: "Current array contribution",
                entities: [
                  { entity: e.pv1Power, name: "PV 1", color: "#f9a825" },
                  { entity: e.pv2Power, name: "PV 2", color: "#fbc02d" },
                  { entity: e.pv3Power, name: "PV 3", color: "#fdd835" },
                ],
                grid_options: { columns: "full" },
              },
              {
                type: "entities",
                title: "String telemetry",
                show_header_toggle: false,
                entities: [
                  entityRow(e.pv1Power, "PV 1 power", "mdi:solar-panel"),
                  entityRow(e.pv1Voltage, "PV 1 voltage"),
                  entityRow(e.pv1Current, "PV 1 current"),
                  entityRow(e.pv2Power, "PV 2 power", "mdi:solar-panel"),
                  entityRow(e.pv2Voltage, "PV 2 voltage"),
                  entityRow(e.pv2Current, "PV 2 current"),
                  entityRow(e.pv3Power, "PV 3 power", "mdi:solar-panel"),
                  entityRow(e.pv3Voltage, "PV 3 voltage"),
                  entityRow(e.pv3Current, "PV 3 current"),
                ],
                grid_options: { columns: "full", rows: 8 },
              },
            ],
          },
          {
            type: "grid",
            cards: [
              heading("Battery trend", "mdi:battery-clock"),
              {
                type: "history-graph",
                title: "State of charge · 7 days",
                hours_to_show: 168,
                entities: [entityRow(e.batteryBankSoc, "Battery SOC")],
                grid_options: { columns: "full", rows: 5 },
              },
              {
                type: "statistics-graph",
                title: "Battery energy · 30 days",
                entities: [
                  entityRow(e.chargingLifetime, "Charged"),
                  entityRow(e.dischargingLifetime, "Discharged"),
                ],
                stat_types: ["change"],
                period: "day",
                days_to_show: 30,
                chart_type: "bar",
                hide_legend: false,
                grid_options: { columns: "full", rows: 6 },
              },
            ],
          },
          {
            type: "grid",
            cards: [
              heading("Thermal and grid quality", "mdi:thermometer-lines"),
              {
                type: "history-graph",
                title: "Inverter temperature · 72 hours",
                hours_to_show: 72,
                entities: [
                  entityRow(e.internalTemperature, "Internal"),
                  entityRow(e.radiator1Temperature, "Radiator 1"),
                  entityRow(e.radiator2Temperature, "Radiator 2"),
                ],
                grid_options: { columns: "full", rows: 5 },
              },
              {
                type: "history-graph",
                title: "Grid voltage and frequency · 24 hours",
                hours_to_show: 24,
                entities: [
                  entityRow(e.gridVoltage, "Grid voltage"),
                  entityRow(e.gridFrequency, "Grid frequency"),
                ],
                grid_options: { columns: "full", rows: 5 },
              },
            ],
          },
        ],
      },
      {
        title: "System",
        path: "system",
        icon: "mdi:solar-power-variant-outline",
        type: "sections",
        max_columns: 2,
        dense_section_placement: true,
        sections: [
          {
            type: "grid",
            cards: [
              heading("Health and connectivity", "mdi:heart-pulse"),
              missingTelemetryCard(e),
              {
                type: "entities",
                title: "Inverter status",
                show_header_toggle: false,
                state_color: true,
                entities: [
                  entityRow(e.cloudStatus, "Cloud status", "mdi:cloud-check"),
                  entityRow(e.connectionLost, "Connection lost", "mdi:lan-disconnect"),
                  entityRow(e.runtimeData, "Runtime data", "mdi:database-check"),
                  entityRow(e.transport, "Transport", "mdi:access-point-network"),
                  entityRow(e.offGrid, "Off-grid", "mdi:transmission-tower-off"),
                  entityRow(e.operatingState, "Operating state", "mdi:state-machine"),
                  entityRow(e.statusCode, "Status code", "mdi:identifier"),
                  entityRow(e.firmwareVersion, "Firmware", "mdi:chip"),
                ],
                grid_options: { columns: "full", rows: 7 },
              },
            ],
          },
          {
            type: "grid",
            cards: [
              heading("Battery bank", "mdi:home-battery-outline"),
              {
                type: "entities",
                title: "Battery and BMS",
                show_header_toggle: false,
                state_color: true,
                entities: [
                  entityRow(e.batteryBankSoc, "State of charge", "mdi:battery-high"),
                  entityRow(e.batteryBankStatus, "Status", "mdi:battery-heart"),
                  entityRow(e.batteryBankPower, "Power", "mdi:battery-charging"),
                  entityRow(e.batteryBankVoltage, "Voltage", "mdi:sine-wave"),
                  entityRow(e.batteryBankCurrent, "Current", "mdi:current-dc"),
                  entityRow(e.batteryChargeRate, "Charge rate", "mdi:speedometer"),
                  entityRow(e.batteryCount, "Battery count", "mdi:battery-multiple"),
                  entityRow(e.batteryRemainingCapacity, "Remaining capacity"),
                  entityRow(e.batteryFullCapacity, "Full capacity"),
                  entityRow(e.bmsChargeAllowed, "BMS charge allowed"),
                  entityRow(e.bmsDischargeAllowed, "BMS discharge allowed"),
                  entityRow(e.bmsForceChargeRequest, "BMS force-charge request"),
                ],
                grid_options: { columns: "full", rows: 10 },
              },
            ],
          },
          {
            type: "grid",
            cards: [
              heading("Electrical detail", "mdi:flash-triangle-outline"),
              {
                type: "entities",
                title: "AC, grid, and backup",
                show_header_toggle: false,
                entities: [
                  entityRow(e.acPower, "AC power"),
                  entityRow(e.acVoltage, "AC voltage"),
                  entityRow(e.outputPower, "Output power"),
                  entityRow(e.totalLoadPower, "Total load power"),
                  entityRow(e.gridPower, "Net grid power"),
                  entityRow(e.gridVoltage, "Grid voltage"),
                  entityRow(e.gridFrequency, "Grid frequency"),
                  entityRow(e.epsPower, "EPS power"),
                  entityRow(e.generatorPower, "Generator power"),
                  entityRow(e.powerFactor, "Power factor"),
                  entityRow(e.powerRating, "Inverter rating"),
                ],
                grid_options: { columns: "full", rows: 9 },
              },
            ],
          },
          {
            type: "grid",
            cards: [
              heading("Daily counters", "mdi:counter"),
              {
                type: "entities",
                title: "Today's energy",
                show_header_toggle: false,
                entities: [
                  entityRow(e.yieldToday, "Solar generated"),
                  entityRow(e.consumptionToday, "EG4 metered consumption"),
                  entityRow(e.gridImportToday, "Grid imported"),
                  entityRow(e.gridExportToday, "Grid exported"),
                  entityRow(e.chargingToday, "Battery charged"),
                  entityRow(e.dischargingToday, "Battery discharged"),
                ],
                grid_options: { columns: "full", rows: 6 },
              },
            ],
          },
        ],
      },
    ],
  };
}

export const dashboardMetadata = Object.freeze({
  urlPath: "eg4-energy",
  title: "EG4 Solar & Battery",
  icon: "mdi:solar-power",
  showInSidebar: true,
  requireAdmin: false,
});
