/** A1 real browser/PG journey plus the A2.1 asset lifecycle through actual UI and typed IPC. */
process.env.PROJECTOS_ORG_EVIDENCE_DIR = 'docs/org-upgrade/evidence/A2.1'
process.env.PROJECTOS_ASSET_E2E = '1'
await import('./org-a1-e2e.mjs')
