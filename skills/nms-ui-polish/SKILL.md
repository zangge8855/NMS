---
name: nms-ui-polish
description: Use when refining this NMS repository's UI, visual hierarchy, theming, or control-panel styling so it feels more premium and enterprise-grade without introducing regressions.
---

# NMS UI Polish

Use this skill whenever the task is about making the interface more polished, premium, or consistent while keeping behavior stable.

## Goals

- Make the product feel like a production control plane, not a demo dashboard.
- Prefer clarity, density, and hierarchy over glow, ornament, or novelty.
- Keep changes low risk by favoring shared tokens and shared component surfaces.

## Workflow

1. Start with shared surfaces first:
   - `client/src/index.css`
   - `client/src/components/Layout/Header.jsx`
   - `client/src/components/Layout/Sidebar.jsx`
2. Prefer token and component-level changes before page-specific overrides.
3. Preserve existing business behavior, tab flow, button meaning, and route structure.
4. Check both themes:
   - `dark`
   - `light`
   - `auto` should still resolve through `ThemeContext`
5. Review both desktop and mobile layouts before considering the work done.
6. After any UI change, run:
   - `cd client && npm run lint`
   - `cd client && npm test`
   - `cd client && npm run build`
7. If `playwright` and `screenshot` are available, use them for smoke paths and before/after visual checks.

## Visual Direction

- Aim for enterprise cloud console styling.
- Keep a restrained blue/neutral palette.
- Reduce heavy blur, neon glow, giant radii, and decorative gradients.
- Use color mainly for state, emphasis, and danger, not surface decoration.
- Make dangerous actions visually distinct and secondary actions quiet.

## UI Audit Checklist

- The page clearly shows current scope: global or single node.
- Headers provide title, context, and a short subtitle where useful.
- Tables are easy to scan and do not look like stacked cards on desktop.
- Empty, loading, error, disabled, and danger states are explicit.
- Dark and light themes both feel intentional rather than inverted.
- Mobile keeps core actions usable without horizontal breakage.

## Preferred Targets

- Shared layout and tokens first.
- High-traffic pages next:
  - `/`
  - `/users`
  - `/servers`
  - `/inbounds`
  - `/system`
- Only then page-specific visual cleanup for secondary screens.
