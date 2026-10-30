# A2.2a — device and local-consent UI

This is an additive Settings feature, not a new product style or a replacement Agent runtime.
The user reaffirmed the approved DAG's Premium Liquid Glass visual authority during this work and
authorized a subsequent system-wide rollout (ADR-0070). The protected Lab and graph are unchanged
in this checkpoint; the Lab's historical five-fix inconsistencies are not called resolved here.

## Actual interface

- Compact the existing account context, retain account/org actions and all old Settings entries.
- Add the real device table: owner, platform, last real heartbeat, current-device marker and
  online/offline/paused/revoked/expired states. Failed reads show “连接待确认”, not stale online certainty.
- Inline enrollment, device detail, state confirmations and scoped project-consent form. Give
  fields persistent labels, default to read-only/eight hours, and confirm the actual canonical root
  through Main's system dialog. The negative native response creates no active local/server grant.
- Show exact consent directories, expiry, file permission and ceiling. Pause/revoke invalidates
  consent. Offline local revoke remains visible as effective with a pending-sync state.
- Explicitly show that task reception is not enabled. No fake jobs, execution statistics or
  implied installation of shared assets. Local directories never appear on another member's device.

## Sources actually consulted

| Source | Evidence and decision |
| --- | --- |
| Frozen product contracts | Root `AGENTS.md`, `PROJECTOS_UI_CONTRACT.md`, `DESIGN.md`, `DESIGN_CHANGELOG.md`, overlay system/audit, `PROJECTOS_DESIGN_SYSTEM.md`, Next UI recovery/migration/open issues/visual baseline/investigation; current Lab, `OpticalGlass.tsx`, `Aurora.jsx`, approved DAG image inspected. Current screenshot authority wins over contradictory historical notes. |
| UI UX Pro Max | `.tmp/reference-uiux/.claude/skills/ui-ux-pro-max/SKILL.md`, commit `28b3b8dee8c976df4fa3e94aed4e092ad43fcb03`. Actual typography/color/UX searches: Chinese Simplified, SaaS, focus not obscured, cancellable motion, permission progressive disclosure. The first permission result was off-topic; reran `permission form progressive disclosure` and used form-label/submit-feedback rules. Rejected alternate SaaS palettes/external font choices because the product direction and installed CJK stack are frozen. |
| Vercel skills | `.tmp/reference-vercel/skills/composition-patterns/SKILL.md` and `react-best-practices/SKILL.md`, commit `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62`; read compound-component, derived-state and dynamic-import rules. Reuse form/feedback primitives, isolate form logic, scope server caches and derive device selection from response; keep heavy editors lazy. |
| Impeccable | `.tmp/reference-impeccable/cursor-plugin/skills/impeccable/SKILL.md`, `reference/operate.md`, `reference/craft-floor.md`, commit `02523aec3e4c4580102d996d1b6a71fbe062e03f`. Context was queried on the existing OrganizationPanel; no invented PRODUCT.md. Actual final `detect <OrganizationPanel.tsx> <OrganizationWorkers.tsx> <organization.css> <workers.css> --json` returns `[]`. |
| shadcn/ui | Read actual [table.tsx](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/registry/new-york-v4/ui/table.tsx) and [MIT license](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md). Studied semantic table composition, row hover and responsive containment. Kept existing project components/tokens; no branded assets or verbatim third-party component are vendored. |
| Sim Studio | Read actual [canvas menu](https://github.com/simstudioai/sim/blob/a52fc509b5b8a18df519ff0781f00c8d45711164/apps/sim/app/workspace/%5BworkspaceId%5D/w/%5BworkflowId%5D/components/canvas-menu/canvas-menu.tsx), blob `ca1f10e18184d60b26c0aea18476639fbd279b84`. Studied controlled popover anchoring, grouped actions and permission-disabled states. No graph/menu composition changed here, no copied brand assets. Project reference license Apache-2.0. |
| Liquid Glass React | Installed `liquid-glass-react` 1.1.1 package metadata and current Electron fallback source inspected. Known displacement/backdrop issue and prior low FPS remain; no new filter is enabled, and no new 60fps claim is made. |
| React Bits | Current Aurora source and attribution (MIT + Commons Clause) inspected. Kept attribution; no shader/effect was copied into this surface. |
| Motion | Installed Motion 14.6.0 (MIT), actual `framer-motion/dist/es/utils/reduced-motion/use-reduced-motion.mjs` inspected after real UI test failed. Its implementation latches the initial media value. A shared `useSyncExternalStore` preference hook now responds to system changes and the saved app setting; the real Electron reduced-motion check covers it. |
| axe-core | Added 4.14.0 as root dev-only dependency, MPL-2.0 verified with `pnpm view axe-core version license --json`. It runs through the external test harness, not the Renderer product bundle. No CSP change. |

The session exposes no dedicated skill-loader tool for these mandated third-party skills.
Actual checked-out instructions and queries were used; this limitation is explicit instead of a
claim that a nonexistent tool was called.

## Visual and accessibility checks

Native `webContents.capturePage` captures 1440/1024, light/dark and 1440 at 125%. The real Electron
journey includes focus entry, labelled fields, explicit confirmations, reduced motion, read failure,
offline local revoke, permission rejection and server/desktop restart. Its native dialog response
is injected at the actual Main-owned Electron port: OS-drawn pixels and physical native-button
input remain unverified. No screenshot or green unit test is called final user visual acceptance.

Rendered axe exposed a duplicate banner and 4.33:1 current-device badge; both were fixed, retaining
the frozen palette. Final reports are beside screenshots in `../evidence/A2.2a/`; full screen-reader
certification, universal contrast and GPU performance are not claimed.
