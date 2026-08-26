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

- The supplier link is encrypted (AES-256-GCM) into the URL token — the
  supplier's token never appears anywhere client-side.
- The worker fetches the supplier server-side on each request (5-min cache
  per token) and rebrands the node names (Chinese → English, brand prefix).
- Clash apps (UA contains clash/mihomo/fugu/streisand/nyanpasu) receive a
  CN-optimized mihomo YAML: ⚡ Auto Speed (url-test), 🔁 Failover (fallback),
  移动/电信专线 carrier groups, CN-direct rules, fake-ip DNS.

## Deploy (Vercel)

1. Vercel → import this repo → Deploy (framework: other, no build step)
2. Every push to `main` auto-deploys

## Security notes

- No secrets in this repo. The worker's key is derived at runtime — supplier
  links are only ever in the URL tokens (client-side) and in memory.
- The supplier URL is fetched server-side only; clients never see it.
- If the supplier blocks your host's IPs (Cloudflare did), deploy from a
  different host (Vercel/Render worked; see deploy history).
