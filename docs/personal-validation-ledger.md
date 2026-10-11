# Personal Validation Ledger (v0.6.1)

MoveMirror tracks whether **you** completed the training dose and whether later games might be observed **after** that milestone. This is a **single-player, local** tool: there is no cloud account and no multi-user database.

## What we can conclude

- Whether the app recorded enough **verified** training evidence to meet the fixed dose rule (`cct-refutation-dose-v1`).
- When the server first recorded that milestone (`qualifiedAt`), with a frozen snapshot explaining the counts.
- Whether imported games **started** before or after that time (for future transfer cohorts).

## What we cannot conclude

- Causal proof that training **caused** better results in real games (N=1, no control group).
- That Defense Lab or Sparring sessions count toward the main training dose (they do not).
- That client-side timestamps alone prove qualification (the server ledger is canonical).

## Where data lives

| Location | Role |
|----------|------|
| `data/validation/` (server) | **Canonical** event log (`events.jsonl`), rebuilt `state.json`, snapshots, exports, migration backups |
| `localStorage` (`move-mirror-state-v4`) | UI cache and legacy compatibility; not authoritative for dose |

## Commands

```bash
npm run validation:verify   # integrity check; fails with actionable errors
npm run validation:export   # writes a timestamped bundle under data/validation/exports/
```

## Backup and restore

1. Stop the engine service.
2. Copy the whole `data/validation/` directory.
3. To restore, replace `data/validation/` and run `npm run validation:verify`.

Importing a backup does **not** silently move `qualifiedAt`; qualification requires server-recorded `intervention_qualified` evidence.

## Reused from v0.3.1

- Dose math: `shared/transfer/intervention.js` (`calculateInterventionQualification`, `cct-refutation-dose-v1`).
- Client mirror: `src/domain/intervention.ts` (UI-only progress; server rebuild wins for validation).
- Transfer exposure: `auditCohortExposure` / frozen cohort rules unchanged.
