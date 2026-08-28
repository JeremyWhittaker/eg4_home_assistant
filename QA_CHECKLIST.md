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
| Desktop rendering | deferred | Run `npm run qa:visual` after live deployment |
| Mobile rendering | deferred | Run `npm run qa:visual` after live deployment |
| Sidebar navigation and all four view routes | deferred | Verify after live deployment |
| Live values, Sankey, charts, and Energy cards | deferred | Verify after live deployment |
| Unknown/unavailable behavior | implemented | Dynamic warning + entity filter; source never coerces unavailable readings to zero |
| Forms, CTAs, and inverter controls | not applicable | Display-only panel intentionally contains none |
| Internal labels such as rebuild/prototype/staging | implemented | Operator copy audit before deployment; none are present |
| Light/dark theme behavior | deferred | Inspect rendered cards in visual QA; native theme tokens only |
| Desktop/mobile Lovelace error-card scan | deferred | Automated by `scripts/visual-qa.mjs` after deployment |
| Home Assistant error log after save | deferred | Inspect after deployment |
| Dashboard round-trip equality | implemented | `verifyDashboard` re-reads metadata and config after every live save |
| Automatic rollback and explicit restore | implemented | Transaction unit tests plus checksum/drift-guarded `--restore` |
| Token absent from logs/backups/repo | implemented | Environment-only auth; backup schema omits token; secret scan required at closeout |
| `noindex`, canonical, and robots | not applicable | Private Home Assistant authenticated panel, not a public website |
| Commit and push | deferred | First green commit: `385bbc5`; no Git remote configured |

