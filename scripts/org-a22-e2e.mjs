/** A2.2a: actual PG / Electron / Runtime; native dialog response injection is explicitly reported. */
process.env.PROJECTOS_ORG_EVIDENCE_DIR = 'docs/org-upgrade/evidence/A2.2a'
process.env.PROJECTOS_WORKER_E2E = '1'
await import('./org-a1-e2e.mjs')
