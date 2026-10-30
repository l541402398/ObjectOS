# Organization assets — A2.1 UI evidence

Date: 2026-10-29 (America/Los_Angeles). Mode: Operate. Authority: the user's approved Premium
Liquid Glass direction, frozen Design Lab DAG, A1 organization Settings and shared overlay system.
This is an extension inside the existing Settings surface, not a page/graph restyle.

## User work

The organization tab offers a searchable/filterable semantic table of real accessible assets.
Selecting a name reveals versions, configuration/permission facts, field comparison and project pins.
Creating/editing is inline. Publishing, deprecating, revoking and unbinding require explicit actions.
There is one Settings scroll owner and no nested modal or extra backdrop.

Agent fields separate role, runtime preference, instruction, allowed tool names and pinned Skill
versions. MCP distinguishes registered definition from installation, credential grant and verified
availability. Tools retain a mandatory approval floor. Read-only members see their scope without
publishing controls; the server independently denies forged writes. Shared configuration does not
claim local execution. A project-read error has its own retry; it is not treated as absent permission.

All new CSS uses `--ui-*` tokens and common organization controls. Body 14px, labels 12–13px,
section headings 16px; Chinese system font fallback is retained. Parent Motion remains bounded
180ms with reduced-motion support. No new WebGL, backdrop filter or expensive effect is enabled.

## Sources actually consulted

- Read the required contract/design/overlay/baseline/recovery/audit documents, current Lab page,
  OpticalGlass/Aurora and approved DAG image. Old progress notes conflict on the five Lab fixes;
  this scope leaves those files unchanged. ADR-0068 records the additive-settings rationale.
- No dedicated skill-loader tool is exposed. Read actual checked-out UI UX Pro Max, Vercel
  composition/React and Impeccable sources at the commits documented in A1's source record.
  This is source consultation, not a claim that an unavailable skill tool ran.
- UI UX Pro Max searches ran for typography, palette, table layout, unobscured focus and interrupted/
  reduced motion. The first color query returned no match; retry `SaaS` returned Micro/General SaaS.
  Those alternate colors and Google font imports were rejected in favor of frozen tokens and
  installed CJK fonts. Table overflow, labels, focus and bounded motion guidance were applied.
- Vercel `patterns-explicit-variants.md` and `async-parallel.md`: separate catalog, editor, detail/
  comparison components, scoped React Query data and independent queries. Server list permissions
  are projected by one query rather than an N+1 request loop.
- Impeccable `context` ran once for the incumbent OrganizationPanel; no PRODUCT.md was invented.
  The user's continuation and established brief authorize this narrow extension. Read craft-floor,
  Operate and audit guidance; manual technical review and source/render detector results are
  recorded in the report. No blanket WCAG certification follows from a detector.
- Installed `apps/desktop/node_modules/liquid-glass-react` 1.1.1 and existing OpticalGlass fallback
  inspected. Previous Electron compatibility limits remain; no new effect or FPS claim.
- Existing attributed React Bits Aurora source inspected; license/attribution preserved.
- Motion uses the existing organization view composition. Sim canvas composition is unchanged;
  the earlier A1 source audit is historical evidence, not a new source-inspection claim this round.

## Visual/a11y review limits

Native Electron captures cover 1440/1024, light/dark and actual 125% zoom, plus empty/error/
publication/readonly states. Keyboard entry, form labels, overflow and real body contrast are checked.
The shared Settings scroll position may show a scrolled viewport; it is not a full-document image.
Source and optional rendered detection are separate evidence. No physical touch-device, full axe,
screen-reader, all-label pixel contrast or foreground FPS benchmark is claimed. Final visual
acceptance remains the user's decision. Global Settings dismissal follows existing behavior;
unsaved editor input must be saved explicitly and is not autosaved to local storage.
