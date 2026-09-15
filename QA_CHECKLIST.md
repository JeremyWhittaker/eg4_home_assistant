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
| Commit and push | implemented | GitHub `origin` configured; clean local `main` tracks and matches `origin/main` |

The final browser report records five allowed external errors from globally loaded Frigate/HACS frontend code: four duplicate `focus-trap` registrations and one source-map 404. None originates from or affects this native dashboard; all dashboard routes contain zero Lovelace error cards.

## Full-inventory revamp gates (2026-09-15)

The table above records the 2026-08-28 release and stays as its shipped evidence. The revamp that expands the panel from four views to nine, and from 60 displayed entities to all 137 the contract resolves — 98 telemetry entities on the telemetry views plus the 39 configuration entities as inert value tiles — adds the gates below. They are `deferred` until the rebuilt dashboard has been deployed and re-inspected in a browser; marking one `implemented` without that evidence would be false.

The nine routes are `/live`, `/energy`, `/solar`, `/battery`, `/grid`, `/performance`, `/system`, `/settings`, and `/station`.

| Gate | Status | Evidence |
| --- | --- | --- |
| Contract covers every enabled entity | deferred | `node deploy.mjs --check` resolves all 137 contract keys with an empty unresolved list, matching the 137 enabled entities in the live registry inventory |
| Shipped figures match the README | deferred | `node deploy.mjs --check` prints `entities=137 cards=232 views=9`; the README's "What it provides" quotes the same three numbers, and its 9 views + 36 sections + 168 cards + 19 badges sum to the 232 |
| Every view renders with no `Entity not found` | deferred | Full-scroll desktop and mobile capture of all nine routes; zero `hui-error-card` tags and zero `Entity not found` text in any segment |
| Every referenced entity resolves in live state | deferred | `validateDashboard` reports no missing live entity; the 137 references are 95 `sensor`, 2 `binary_sensor`, 1 `update`, 15 `number`, 18 `switch`, 4 `select`, and 2 `button` |
| Sidebar and route navigation | deferred | The **EG4 Solar & Battery** sidebar link opens, and each of the nine view tabs loads its own route without a redirect |
| Phone layout, 390×844 | deferred | Every view scrolled top to bottom: no horizontal scroll, no clipped tile or row names, headings legible, and the two-column `grid_options` tiles collapse to full width |
| Desktop layout, 1920×1080 | deferred | Every view at `max_columns`: sections balance, the long `entities` cards on Grid & AC do not strand an orphaned column, Configuration's seven tile groups keep their headings with their tiles, charts keep a readable aspect |
| Temperatures are unmistakably the inverter's | deferred | Copy audit of every temperature label, tile name, heading, and chart legend on **Equipment** and **Trends**: each reads as an inverter internal or radiator/heatsink temperature, the explanatory note is present, and no label anywhere implies a battery temperature |
| Battery limitation note present and accurate | deferred | The **Battery** view's note states one aggregate bank for two modules, `Battery Count` = 2 as the only per-module fact, no per-battery, per-cell, or per-module thermal entity, the cloud-only cause, and the local Modbus route as the thing that would change it |
| Battery capacity and BMS detail render real values | deferred | Capacity percent, remaining, current, full, and maximum capacity, module count, bank status, and the three BMS permission sensors all show live values rather than `unknown` |
| A control entity appears only as an inert tile | deferred | `validateDashboard`'s control rule passes over the whole configuration: each of the 39 control entities is held by exactly one tile that declares no `features` and pins all three actions, and its inert-tile count equals its textual occurrence count, so it is named nowhere else. No `time.` or `script.` reference exists at all |
| Nothing on the page is actionable | deferred | Every `tile` and `entity` card carries `noControlActions()`, which is what makes the control tiles inert; the rows inside `entities`, `history-graph`, and `statistics-graph` cards carry no actions of their own, and those cards only ever hold reporting-domain entities. No toggle, slider, dropdown, time picker, or install button renders on any view, and a tap opens more-info and changes nothing |
| Configuration view shows values, not controls | deferred | All 39 control-domain entities appear grouped by what they govern across seven sections, each on a tile showing its live state; the five twice-published mode switches read as "(1 of 2)" and "(2 of 2)"; no card offers a toggle, slider, or dropdown; the device-page links resolve to the inverter and station device pages |
| Disabled entities stay off the page | deferred | No reference matches any of the 28 integration-disabled entities, and the Configuration view's "Not registered for use" section describes them |
| Duplicate-name switches pin to a stable entity | deferred | The five twice-published mode switches resolve through their `index`/`of` pins by sorted entity id; the same key means the same register across a Home Assistant restart |
| Missing-telemetry card behaves | deferred | The `entity-filter` card stays hidden while every watched entity is healthy and renders the affected rows when one reports `unknown` or `unavailable`; confirmed against a genuinely unavailable entity, not a mocked state |
| Unresolved-entity card behaves | deferred | With the full contract resolving, the card is absent from **Live** and **Equipment**; with a contract entry the integration no longer publishes, it names that entity and its reason and the deployment still succeeds |
| Native cards only | deferred | Card allowlist rejects `custom:*`, and every card type used by the nine views is present in `ALLOWED_TYPES` |
| Read-only guarantee still enforced, not just observed | deferred | The unit suite fails a deliberate mutating-action fixture, and fails four deliberate control-entity shapes: on a non-tile card, on a tile carrying `features`, on a tile whose `icon_tap_action` is unpinned, and on a good tile plus a second mention elsewhere |
| Light and dark theme | deferred | Every view inspected in both modes at desktop and mobile; native colors and the distribution palettes stay legible |
| Home Assistant error log after save | deferred | `system_log/list` contains no dashboard, Lovelace, template, or energy-card record after deployment |
| Round-trip, rollback, and restore | deferred | `verifyDashboard` re-reads metadata and configuration after the save; a checksum- and drift-guarded `--restore` is exercised |
| No serial, station address, or token in the repository | deferred | Secret scan before closeout; the live entity inventory stays a working artifact outside the repository, and the station address exists only as a semantic entity name in the discovery contract |
| Visual QA runner covers the new routes | blocked | `scripts/visual-qa.mjs` still enumerates the four routes of the previous design. Until that list holds all nine, the runner will report a clean pass while never opening Solar, Battery, Grid & AC, Configuration, or Station |

## Local-dongle view gates (2026-09-15)

These gates cover the two views added for the `eg4_local` integration — **Battery Cells** (`/cells`) and **Local Inverter** (`/local`) — that surface the per-cell BMS data the EG4 cloud does not expose. The offline gates are `implemented` now; every gate that needs a live `eg4_local` device or a browser is `deferred` until the integration is installed and the rebuilt dashboard is re-inspected, because marking one `implemented` without that evidence would be false.

With the local integration present the routes become `/live`, `/energy`, `/solar`, `/battery`, `/cells`, `/local`, `/grid`, `/performance`, `/system`, `/settings`, `/station`. With it absent, `/local` drops and `/cells` remains as the cloud-vs-local explainer.

| Gate | Status | Evidence |
| --- | --- | --- |
| Local contract resolves by device + name, no id literal | implemented | `LOCAL_ENTITIES` in `src/discovery.mjs` is `[domain, originalName, options]`; the local device is matched by `eg4_local` platform; the "no entity id literal in src/" unit test passes |
| Local entities kept in a separate namespace | implemented | `discovery.local` holds the local `entities`/`catalog`/`unresolved`; the cloud contract stays 137 and every count asserted against it is unchanged; `npm run check` green |
| Every resolved local entity is on a card | implemented | Unit test resolves all 46 local fields and asserts none is withheld; diagnostic `entities cloud=137 local=46 rendered=183 withheld=0` |
| Cloud-only build degrades gracefully | implemented | Unit test with the local device absent: `/local` drops, `/cells` stays as the "Local dongle: not detected" explainer, no `sensor.eg4_local_*` reference exists, no `undefined` leaks, and `validateDashboard` passes |
| Provisional local fields labelled provisional | implemented | Unit test asserts every `provisional:true` field is named with "(provisional)" on some card; reg67 inverter-side probe is not in the contract and no "battery temperature" claim appears |
| Cell delta is the headline | implemented | The `/cells` view leads with a gauge bound to `cell voltage delta`, banded green/yellow/red; unit test confirms the gauge entity is the delta |
| Native cards only on the local views | implemented | Both views use only `heading`, `markdown`, `tile`, `gauge`, `entities`, `entity-filter`, `distribution`, and `history-graph`; all in `ALLOWED_TYPES`; no `custom:*` |
| Local views are read-only | implemented | Every `tile`/`entity`/badge on the local views carries `noControlActions()`; all local entities are `sensor`; the actuation unit tests pass over the whole dashboard |
| Deterministic ids match the integration | deferred | Cross-check the live `eg4_local` entity ids against the table in `docs/analysis.md`; any mismatch shows as an unresolved field on the page rather than a crash, and is reconciled by aligning the original name |
| Battery Cells renders real per-cell values | deferred | With the dongle connected, cell voltage max/min/delta, pack capacity, and module count show live values; the provisional section shows cell temps, cycle count, pack current, and SOH; the delta gauge sits in its expected band |
| Local Inverter stands on its own | deferred | With the dongle connected, `/local` shows PV strings, battery, grid & AC, inverter temperatures, energy today/lifetime, and status/identity, all from the dongle, with no `unknown` on a healthy system |
| Local missing-telemetry card behaves | deferred | The `/cells` `entity-filter` stays hidden while the dongle is healthy and lists the affected rows when a local reading goes `unknown`/`unavailable` |
| Phone and desktop layout of the local views | deferred | `/cells` and `/local` scrolled top to bottom at 390×844 and at `max_columns` 1920×1080: no horizontal scroll, no clipped names, the delta gauge and charts keep a readable aspect |
| Light and dark theme of the local views | deferred | `/cells` and `/local` inspected in both modes; the delta gauge bands and the distribution palette stay legible |
| Visual QA runner covers `/cells` and `/local` | blocked | `scripts/visual-qa.mjs` must add the two new routes before its report can be read as full coverage |
