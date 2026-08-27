# SP VPN

Link generator + live quota site. Deployed on **Vercel**.

## What it does

Paste a supplier subscription link → it generates a rebranded "one link"
that works in any VPN app (Shadowrocket, Clash, v2rayNG, NekoBox, Hiddify):

| Route | Purpose |
|---|---|
| `/` | Client page — paste your supplier link → get your personal quota page |
| `/rebrand` | Seller tool — paste supplier link(s) → rebranded links + client packs |
| `/tool` | Same as /rebrand (alias name) |
| `/q/<token>` | Client's personal live quota page (auto-refreshes, supplier fetched server-side) |
| `/all/<brand>?t=<token>` | THE ONE LINK — auto-detects the app: Clash apps get mihomo YAML, everyone else gets base64 SR-format subscription |
| `/sub/<token>?brand=` | Plain mihomo YAML (Clash auto-update profile) |
| `/share/<token>?brand=` | Plain rebranded node list (add `&file=1` to download as .txt) |
| `/sr/<brand>?t=<token>` | Base64 SR-format subscription |
| `/healthz` | Health check |

## How the one-link works

- The supplier link is encoded (base64url — see security notes) into the URL
  token; the supplier's token never appears anywhere client-side.
- The worker fetches the supplier server-side on each request (5-min cache
  per token) and rebrands the node names (Chinese → English, brand prefix).
- Clash apps (UA contains clash/mihomo/fugu/streisand/nyanpasu/stash) receive a
  CN-optimized mihomo YAML: ⚡ Auto Speed (url-test), 🔁 Failover (fallback),
  移动/电信专线 carrier groups, CN-direct rules, fake-ip DNS.

## Client compatibility matrix

Verified in `test/full-proof.mjs` (291 checks) — each app's **real User-Agent** is
simulated, and the payload is validated with the same rules the app's engine
enforces at import (mihomo startup checks for YAML; byte-identical link
round-trip + `subscription-userinfo` for base64):

| App | Receives | Status |
|---|---|---|
| **Clash Verge** | mihomo YAML | ✅ (use its mihomo/Meta core option) |
| **Clash Verge Rev** | mihomo YAML | ✅ |
| **Clash Meta for Android** | mihomo YAML | ✅ |
| **ClashX Meta / ClashX** | mihomo YAML | ✅ Meta core (⚠️ original ClashX's EOL premium core has no vless) |
| **FlClash** | mihomo YAML | ✅ |
| **Stash (iOS)** | mihomo YAML | ✅ |
| **mihomo** | mihomo YAML | ✅ |
| **v2rayNG** | base64 SR sub | ✅ |
| **v2rayN** | base64 SR sub | ✅ |
| **NekoBox** | base64 SR sub | ✅ |
| **Hiddify / HiddifyNext** | base64 SR sub | ✅ |
| **Shadowrocket** | base64 SR sub | ✅ |

For base64 apps the original share links survive **byte-identical** (only the
node name is rebranded), so reality/ws/grpc parameters are never mangled.

## Clash compatibility (important)

Clash Verge / Clash Meta / mihomo **refuse to load the whole profile** when two
proxies share a name (`proxy X is the duplicate name`). Since Chinese node names
often translate to the same English name (香港•移联01 and 香港•移动01 both become
"Hong Kong•Mobile01"), the generator:

- gives every node a **unique** display name (appends " 2", " 3", … on collision)
  and never lets a node name collide with a group name / DIRECT / REJECT / GLOBAL
- parses **vless://, trojan:// and vmess://** links (not just vless) and keeps
  their **ws / grpc / h2 / http** transport options (grpc service name, ws
  early-data path, http Host headers, vmess legacy aid-64 & http-obfs)
- networks mihomo-stable doesn't support (xhttp, quic) fall back to tcp so the
  **import never fails** for the rest of the nodes
- defaults `client-fingerprint: chrome` for REALITY nodes missing `fp=`
- omits `external-controller` (a hardcoded port breaks Clash Verge's own controller)
- keeps quota placeholder nodes (剩余流量…) visible in the top selector but out of
  the auto speed-test / failover groups
- strips supplier BOM/CRLF quirks and survives stray `%` in node names
- returns real HTTP error codes (502 + plain text) when the supplier can't be
  fetched, so apps show the actual reason instead of a confusing parse error
- sends `subscription-userinfo` + `profile-web-page-url` + `profile-update-interval`
  headers, so Clash Verge / v2rayNG display live quota & expiry next to the profile
- fetches the supplier under a **7s total budget** shared by every retry attempt
  (headers and body), so a hung panel can never outlive Vercel's ~10s limit —
  the platform used to kill the function mid-response and Clash Meta / NekoBox /
  v2rayNG reported `EOF` / "no recent network activity" instead of an error

## Deploy (Vercel)

1. Vercel → import this repo → Deploy (framework: other, no build step)
2. Every push to `main` auto-deploys

## Security notes

- No secrets in this repo.
- **Honest caveat:** the URL token is base64url of the supplier link — anyone
  holding the one-link can decode it back. It hides the supplier link from
  casual viewing only; it is NOT encryption. Swap `b64e/b64d` for real
  AES-256-GCM (WebCrypto, key in an env var) if that matters to you.
- The supplier URL is fetched server-side only; client apps never see it
  (it only lives inside the token).
- If the supplier blocks your host's IPs (Cloudflare did), deploy from a
  different host (Vercel/Render worked; see deploy history).
