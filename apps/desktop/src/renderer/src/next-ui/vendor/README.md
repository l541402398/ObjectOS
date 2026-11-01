# Upstream UI components

These are source adaptations, not remote runtime dependencies. No accounts, services, analytics, workflow execution or brand assets from upstream are included.

| Local source | Upstream source (pinned) | License | Adaptation |
| --- | --- | --- | --- |
| `CanvasControls.tsx` / `workbench-controls.css` | [Sim Studio workflow-controls.tsx](https://github.com/simstudioai/sim/blob/a52fc509b5b8a18df519ff0781f00c8d45711164/apps/sim/app/workspace/%5BworkspaceId%5D/w/%5BworkflowId%5D/components/workflow-controls/workflow-controls.tsx) | Apache-2.0, `LICENSE-Sim.txt`, `NOTICE-Sim.txt` | Reuses the bottom-left floating control composition, 36px toolbar / 28px controls, separator and memoized fit callback. Keeps ProjectOS's readonly graph and zoom/fit actions; uses existing React Flow, Tooltip, icons, semantic tokens and reduced-motion preference. |
| `tabs.tsx` / `workbench-controls.css` | [shadcn/ui tabs.tsx](https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/registry/new-york-v4/ui/tabs.tsx) | MIT, `LICENSE-shadcn.txt` | Reuses Root/List/Trigger/Content composition, data slots, orientation and line variant. Existing Radix package supplies keyboard/focus/ARIA behavior. Tailwind/CVA replaced with ProjectOS token CSS and existing clsx. |

Original source snapshots are in `docs/design/product-workbench/sources/`. Changes are marked in each adapted source file. Full licenses and the Sim NOTICE are bundled into Settings → About. The upstream Sim sidebar and canvas menu were inspected for composition; their service-connected code was not copied.
