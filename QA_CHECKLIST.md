# Release and visual QA checklist

Status values: `implemented`, `blocked`, `deferred`, or `not applicable`.

| Gate | Status | Evidence |
| --- | --- | --- |
| Live EG4 entity/device inventory | implemented | `node deploy.mjs --check`: one 18KPV, linked battery bank, 60 referenced live entities |
| Direct EG4 cloud corroboration | implemented | 2026-08-28 audit; summarized in `docs/analysis.md` |
| Grid and battery sign convention | implemented | Seven-day HA history includes both charge and discharge; positive=charge, negative=discharge |
| Candidate references only live entities | implemented | Semantic discovery plus `validateDashboard`; unit and live preflight evidence |
| Monitoring-only scope | implemented | Only `sensor`/`binary_sensor`; validation forbids control domains and mutating actions |
| Built-in card dependency gate | implemented | Card allowlist rejects `custom:*`; live resource audit found no relevant custom card |
| Server-side Jinja template render | implemented | Live `--check` renders the summary through `/api/template`; healthy SOC path is covered |
| Native live-power prerequisites | implemented | Energy prefs have no `stat_rate`; incompatible `power-sankey`/`power-sources-graph` cards are intentionally omitted in favor of direct EG4 cards |
| Independent acceptance review | implemented | Reviewer found three issues; all remediated; final scored result is `approve` with zero findings |
| Desktop rendering | implemented | `/tmp/eg4-home-assistant-qa-pass/report.json`: all four routes; light mode plus dark Live/Energy |
| Mobile rendering | implemented | Same report: all four 390×844 routes with overlapping full-scroll screenshots |
| Sidebar navigation and all four view routes | implemented | Live browser found the Solar & Storage sidebar link and rendered `/live`, `/energy`, `/performance`, and `/system` |
| Live values, Sankey, charts, and Energy cards | implemented | 37 screenshots inspected; live telemetry, Energy Sankey, gauges, charts, distributions, and friendly lifetime totals render with real data |
| Unknown/unavailable behavior | implemented | Dynamic warning + entity filter; source never coerces unavailable readings to zero |
| Forms, CTAs, and inverter controls | not applicable | Display-only panel intentionally contains none |
| Internal labels such as rebuild/prototype/staging | implemented | Operator copy audit before deployment; none are present |
| Light/dark theme behavior | implemented | Desktop/mobile Live and Energy inspected in both modes; native colors remain legible |
| Full-scroll desktop/mobile Lovelace error-card scan | implemented | 12 capture cases / 37 overlapping screenshots; zero error-tag segments and zero actionable browser errors |
| Home Assistant error log after save | implemented | `system_log/list`: 14 total records, zero matching dashboard/Lovelace/template/energy-card terms |
| Dashboard round-trip equality | implemented | `verifyDashboard` re-reads metadata and config after every live save |
| Automatic rollback and explicit restore | implemented | Transaction unit tests plus checksum/drift-guarded `--restore` |
| Token absent from logs/backups/repo | implemented | Environment-only auth; backup schema omits token; secret scan required at closeout |
| `noindex`, canonical, and robots | not applicable | Private Home Assistant authenticated panel, not a public website |
| Commit and push | blocked | All task work is committed locally; no Git remote is configured, so push is unavailable |

The final browser report records five allowed external errors from globally loaded Frigate/HACS frontend code: four duplicate `focus-trap` registrations and one source-map 404. None originates from or affects this native dashboard; all dashboard routes contain zero Lovelace error cards.
