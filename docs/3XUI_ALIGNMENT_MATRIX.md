# NMS <-> 3x-ui Alignment Matrix

Updated: 2026-03-09
Baseline: `MHSanaei/3x-ui v2.8.11` released on 2026-03-04

Official sources:
- Releases: https://github.com/MHSanaei/3x-ui/releases
- Wiki Home: https://github.com/MHSanaei/3x-ui/wiki
- Wiki Configuration/API: https://github.com/MHSanaei/3x-ui/wiki/Configuration

## Protocol Naming

NMS now treats the latest 3x-ui naming as canonical:

- `vmess`
- `vless`
- `trojan`
- `shadowsocks`
- `http`
- `tunnel`
- `mixed`
- `wireguard`
- `tun`

Backward-compatible aliases that must still be accepted when reading older node data:

- `dokodemo-door -> tunnel`
- `socks -> mixed`

Rule:

- Read old and new names
- Display the latest canonical name in UI
- Write the latest canonical name on create/update

## Aligned in NMS

- Xray service control: stop, restart, install/switch version
- Xray config viewer
- Node geofile updates
- Node database export/import in single-node scope
- Telegram backup trigger
- Node tool helpers exposed by 3x-ui:
  - `UUID`
  - `X25519`
  - `ML-DSA-65`
  - `ML-KEM-768`
  - `VLESS Enc`
  - `ECH Cert`
- Capability matrix for:
  - canonical protocol names
  - node tool availability
  - official feature state vs NMS integration state

## Guided Only

These features are acknowledged from the latest 3x-ui project, but NMS currently keeps them as guided workflows instead of direct write operations:

- Telegram bot settings
- Panel web base path
- Panel certificate path writes
- Cloudflare WARP
- Fail2Ban

Reason:

- no stable documented write API is relied on by NMS, or
- the action is high-risk and better left to explicit node-side operation

## UI Surfaces

- `/server`
  now positioned as the node control console
- `/capabilities`
  now acts as the 3x-ui alignment matrix
- `/tools`
  now uses capability-derived node tools instead of a static local list
- `/subscriptions`
  now includes token lifecycle management for admins

## Verification Checklist

- Canonical names render as `Tunnel` and `Mixed` for old node payloads
- `/api/protocol-schemas` returns legacy alias metadata
- `/api/capabilities/:serverId` returns:
  - canonical protocols
  - protocol detail objects
  - system module states
  - tool metadata with UI entrypoint labels
- Node control console disables single-node-only actions in global scope
- Subscription center can issue, view, and revoke tokens
