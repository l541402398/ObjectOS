/** Focused native validation after a single navigation-caption ink-token change. */
process.env.PROJECTOS_UX_CONTRAST_ONLY='1'
process.env.PROJECTOS_UX_OUTPUT='docs/v2/evidence/organization-workspace-ux/nav-contrast-followup'
await import('./organization-workspace-ux-e2e.mjs')
