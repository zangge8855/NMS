---
name: nms-3xui-alignment
description: Use when aligning this NMS repository with the latest 3x-ui releases, source code, protocol naming, node capabilities, or panel workflows, including UI audits and capability matrix updates.
---

# NMS 3x-ui Alignment

Use this skill whenever the task is about keeping NMS aligned with upstream 3x-ui.

## Workflow

1. Confirm the latest 3x-ui release before making product or API alignment claims.
2. Check official sources in this order:
   - Releases
   - Wiki Home
   - Wiki Configuration/API
   - Current upstream source paths if the release notes are not enough
3. Classify each target capability into one of:
   - `integrated`
   - `api_available_ui_missing`
   - `guided_only`
   - `intentionally_unsupported`
4. For protocol names:
   - treat upstream latest naming as canonical
   - preserve backward-compatible alias reads
   - display canonical names in UI
   - write canonical names on create/update
5. Update the local alignment record in `docs/3XUI_ALIGNMENT_MATRIX.md` when the decision surface changes.

## Current Canonical Protocol Rules

- `dokodemo-door -> tunnel`
- `socks -> mixed`

Canonical set:

- `vmess`
- `vless`
- `trojan`
- `shadowsocks`
- `http`
- `tunnel`
- `mixed`
- `wireguard`
- `tun`

## UI Audit Checklist

- The page must clearly show whether the operator is in cluster scope or single-node scope.
- High-risk actions must say whether they restart Xray, interrupt traffic, or only work on single-node scope.
- Capability pages must distinguish:
  - supported by 3x-ui
  - supported by NMS
  - available on the current node
- Avoid generic “manual” wording when the real state is “official feature exists but NMS intentionally keeps it guided-only”.

## Preferred Surfaces

- Node operations belong in `/server`
- Capability matrix belongs in `/capabilities`
- Node helper generators belong in `/tools` or `/server`
- Subscription token lifecycle belongs in `/subscriptions`

## References

- `docs/3XUI_ALIGNMENT_MATRIX.md`
- `server/lib/protocolCatalog.js`
- `server/routes/capabilities.js`
- `server/routes/protocolSchemas.js`
