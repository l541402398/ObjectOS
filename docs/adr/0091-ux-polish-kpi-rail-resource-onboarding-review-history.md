# ADR-0091 — UX polish 3: KPI rail, resource onboarding, populated review history

Date: 2026-11-10. Base: `feature/ux-consolidation` (PR #4, ADR-0090).

## Decision

1. **项目态势 KPI rail** (`features/overview/KpiRail.tsx`). The four bordered metric pills become one
   strip with hairline dividers. Each block: label, large tabular number, one honest mini-visual
   derived from real counts (progress arc, agent segments, a pulse when approvals wait, milestone arc)
   and a one-line status. Blocks with a destination are keyboard-focusable links (Enter/Space) with a
   hover/focus reveal of the destination. No trend lines are drawn because no time series exists.
2. **资源与连接**. Empty state is a guided onboarding: line illustration drawn in SVG with tokens, a
   clickable four-step track (登记主机 → 绑定凭据 → 测试并固定指纹 → 用作部署目标) and three security
   principles. Populated state groups resources into clusters by their first label, with a health dot,
   cluster health strip, real latency bars from the last connection tests, health filters and search.
   Rows expand inline (profile ledger, fingerprint callouts, test timeline, actions). Credentials are a
   list view. All mutations and dialogs are unchanged.
3. **审批「记录」populated**. Summary (decision count, approval rate, median decision time), outcome
   filters with counts, a source switch (工具请求 / 交付审批), day-grouped entries showing verdict,
   duration and the decision reason. The sheet shows who requested / who decided / duration, the reason
   as a quote, the decision trail, and reuses the review-room diff (`ReviewDiff` over `approval.preview`)
   or the command readout.
4. **Opt-in demo seeds** for inspection only: `PROJECTOS_SEED_DEMO_REVIEW_HISTORY=1` (7 decided tool
   approvals + 2 decided delivery approvals spread over three days) and `PROJECTOS_SEED_DEMO_RESOURCES=1`
   (3 SSH hosts, a Kubernetes cluster and a pipeline with test history; the credential points at a
   vault key that does not exist, so a real test fails honestly). The default demo is unchanged.
5. **Quick wins**: the review room back link says 返回工作台 (or 返回 Agent 协作 when opened from the
   graph with `?return=agents`). Executing / waiting agents in the collaboration graph get a quiet
   rotating border beam (pure CSS `@property` + conic mask; static ring under reduced motion).

## Third-party code

None added. Border beam and segmented meters are re-implementations of common patterns using the
project's tokens; no code was copied from Bencho, Libraries.dev or Watermelon UI, and no dependency
was installed. No paid kits were used.
