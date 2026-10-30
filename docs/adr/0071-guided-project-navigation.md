# ADR-0071 — Clear next actions, preserved autonomy, coherent navigation

- Date: 2026-10-30.
- Status: authorized by the user's request in this conversation.
- Scope: renderer presentation and existing read/cache/navigation APIs only.

The user reports overlapping entry points, crowded pages, unclear manual next steps and text
appearing after the page frame. They explicitly require assisted, autonomous and existing managed
modes to remain. This extends ADR-0070 without changing policy, scheduling or persistence.

1. Expose the existing persisted work mode in the project home and reuse it in the action center.
   Preserve all three modes and their existing server semantics. Never infer execution from an
   empty action list; show actual journey state and ownership.
2. Make the project home the summary and next-action surface. The existing detailed work console,
   plan editor, approvals, audit and resource management remain reachable. Show advanced controls
   on demand and link directly to the persisted object requiring attention.
3. Preserve explicit approval/grant boundaries. A presentation change cannot silently issue a
   grant, approve a plan, create a deployment or claim a model completed a whole lifecycle.
4. Prepare a destination's primary read queries in the existing React Query cache before route
   commitment; retain the current page while loading and announce navigation. Cached revisits
   remain immediate. Terminal errors must remain visible and navigation must be interruptible.
5. Remove the historical whole-page text fade. Keep the approved optical composition and Motion
   choreography on local interactions. Verify navigation under renderer load, cached navigation, keyboard and
   mode persistence, alongside the system screenshots.

The user separately requested directional pulses in Agent collaboration. Permit bounded subtle
pulses on running/selected relationships, retaining solid base edges and arrow direction. Include
a pause control and honor live OS/app reduced-motion preferences. Pulses visualize relationships;
they do not assert that a tool executed or an approval was granted.

## Follow-up: lifecycle ownership and visual rhythm

The user reports that iterations, versions and environments are confusing and that unrelated
page typography/control densities feel discordant. Present the existing ownership explicitly:
Iteration → Version → release output; Environment → Project, reused by multiple releases.
Move the unchanged environment-create form into deployment setup. Do not alter schema or gates.
Collapse the global journey into current stage plus its next action, preserving its full expanded
stage entries. Apply the approved Lab's shared font stack and a restrained type/control scale;
retain comparison screenshots and do not claim subjective visual approval from automated checks.

## Follow-up: local typography and cold detail/settings readiness

User subsequently identifies sharp/mismatched type and blank white reading areas, and reports that
text still appears late. Keep the approved optical workspace; replace the mixed system stacks with
the full locally packaged Noto Sans SC variable face and preserve its OFL notice. Explicitly map
legacy font aliases, including Chinese fallback in code, and wait for the face before first mount.
Use opaque cool reading gradients and real intermediate weights; do not blur text.

Prepare Settings categories and task/run detail in the existing read cache before committing their
content. Show pending status while retaining the previous surface. Latest choice wins, closing
invalidates an outstanding opening, errors remain errors, and no read gate performs mutations.
Required route keys must match mounted views, including dependent queries. Validate delayed reads
separately from real native cold-frame/font inspection; cached-only navigation is insufficient.

## Follow-up: restore the startup composition and a visible lifecycle path

The user explicitly rejects the plain startup text and the overly compressed global `3/9` journey.
This supersedes the earlier decision to collapse the global journey to only its current stage.
It does not alter the protected Design Lab's separate four-icon stage route.

- Keep all nine real project stages visible by default, with a named current phase, its real state,
  and the existing next action. Use an ordered list, `aria-current="step"`, completed checkmarks and
  numbered future stages. Completion count belongs in details and is labelled as completed stages.
- Reflow the global path for narrow/zoomed windows without hiding stage names. Detailed reasons
  remain on demand. Stage entry buttons only navigate to the existing projection's routes.
- Early HTML, router hydration and bootstrap use one authored loading composition. A build-time
  local HTML fragment and common CSS prevent the old plain-text fallback from returning. This
  static fragment never interpolates business data or external HTML.
- Read the saved theme and accessibility preferences through a small external startup script before
  first paint. Keep the production CSP and preload/process boundaries unchanged. No inline script.
- Preserve the local font-ready gate and wait for its font set to settle; do not add a minimum
  loading duration, a fabricated percentage, or a claim that startup stages completed.
- Pre-React loading motion uses CSS; React detail choreography uses the installed Motion library.
  Honor OS/app reduced motion. Runtime, policy, approvals, autonomy modes and persistence are unchanged.
