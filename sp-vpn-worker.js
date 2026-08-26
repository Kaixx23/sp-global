// SP VPN — Cloudflare Worker
// Your SP VPN one-link generator, hosted on Cloudflare (reachable from China).
// Deploy: Cloudflare dashboard → Workers & Pages → Create Worker → paste this file → Deploy.

// ---------------- translation ----------------
const INFO_PREFIX = [
  ["距离下次重置剩余", "Reset in"],
  ["剩余流量", "Remaining"],
  ["套餐到期", "Expires"],
  ["到期时间", "Expires"],
  ["流量到期", "Expires"],
  ["剩余", "Remaining"],
  ["到期", "Expires"],
];
const COUNTRY = {
  "日本": "Japan", "新加坡": "Singapore", "香港": "Hong Kong", "台湾": "Taiwan",
  "韩国": "Korea", "美国": "USA", "英国": "UK", "德国": "Germany", "法国": "France",
  "加拿大": "Canada", "澳大利亚": "Australia", "中国": "China", "泰国": "Thailand",
  "越南": "Vietnam", "印度": "India", "俄罗斯": "Russia", "荷兰": "Netherlands",
  "瑞典": "Sweden", "芬兰": "Finland", "挪威": "Norway", "意大利": "Italy",
  "西班牙": "Spain", "瑞士": "Switzerland", "奥地利": "Austria", "葡萄牙": "Portugal",
  "迪拜": "Dubai", "土耳其": "Turkey", "巴西": "Brazil", "墨西哥": "Mexico",
};
const CARRIER = {
  "移联": "Mobile", "移动": "Mobile", "联通": "Unicom", "电信": "Telecom",
  "家宽": "Home", "机房": "IDC", "广电": "Cable", "教育网": "Edu", "三线": "Tri-line", "原生": "Native",
};

function translateName(name) {
  let n = name;
  for (const [zh, en] of INFO_PREFIX) {
    if (n.startsWith(zh)) {
      n = en + " " + n.slice(zh.length).replace(/^[：:\s]+/, "").trim();
      break;
    }
  }
  for (const [zh, en] of Object.entries(COUNTRY)) n = n.split(zh).join(en);
  for (const [zh, en] of Object.entries(CARRIER)) n = n.split(zh).join(en);
  n = n.split("天").join(" days").split("小时").join(" hours").split("分钟").join(" min");
  return n.replace(/\s{2,}/g, " ").trim();
}

function carrierOf(name) {
  if (name.includes("电信")) return "Telecom";
  if (name.includes("联通")) return "Unicom";
  if (name.includes("移动") || name.includes("移联")) return "Mobile";
  return null;
}

// ---------------- base64url tokens ----------------
function b64e(s) {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64d(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return decodeURIComponent(escape(atob(s)));
}
function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
function encName(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// ---------------- subscription fetch ----------------
function tryDecodeB64(s) {
  try {
    const t = decodeURIComponent(escape(atob(s.replace(/\s/g, ""))));
    if (t.includes("://") || t.includes("STATUS=")) return t;
  } catch (e) {}
  return s;
}

async function fetchSubscription(url) {
  const uas = [
    "Shadowrocket/2.2.32",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "curl/8.5.0",
  ];
  let last = "no response";
  for (const ua of uas) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": ua } });
      const rawText = (await res.text()).trim();
      const text = tryDecodeB64(rawText);
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const links = lines.filter((l) => /^[a-z0-9+.-]+:\/\//i.test(l));
      if (links.length) {
        return { status: lines.find((l) => l.startsWith("STATUS=")) || "", links };
      }
      last = "provider returned HTTP " + res.status + " with no nodes - content starts: " + rawText.slice(0, 100).replace(/\s+/g, " ");
    } catch (e) {
      last = "fetch failed: " + e.message;
    }
  }
  throw new Error(last);
}

// ---------------- node parsing / building ----------------
function parseVless(link) {
  const i = link.indexOf("#");
  const uri = i >= 0 ? link.slice(0, i) : link;
  const frag = i >= 0 ? link.slice(i + 1) : "";
  const m = uri.match(/^vless:\/\/([^@]+)@([^:@]+):(\d+)(?:\?(.*))?$/i);
  if (!m) return null;
  const q = new URLSearchParams(m[4] || "");
  const g = (k) => q.get(k) || "";
  return {
    name: safeDecode(frag), uuid: m[1], server: m[2], port: parseInt(m[3], 10),
    net: g("type") || "tcp", security: g("security"), sni: g("sni"), fp: g("fp"),
    pbk: g("pbk"), sid: g("sid"), flow: g("flow"), path: g("path"), ws_host: g("host"),
  };
}

function rebrandLink(link, brand) {
  const i = link.indexOf("#");
  const base = i >= 0 ? link.slice(0, i) : link;
  const frag = i >= 0 ? link.slice(i + 1) : "";
  const en = translateName(safeDecode(frag)) || brand;
  return base + "#" + encName(en);
}

function buildShare(status, links, brand) {
  const out = [];
  if (status) out.push(status);
  out.push("[General]", "REMARK=" + brand);
  for (const l of links) out.push(rebrandLink(l, brand));
  return out.join("\n") + "\n";
}

const yq = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

function buildYaml(status, proxies, brand) {
  const branded = proxies.map((p, i) => ({ ...p, disp: translateName(p.name) || brand + " " + (i + 1) }));
  const names = branded.map((p) => p.disp);
  const carrierNodes = {};
  branded.forEach((p) => {
    const c = carrierOf(p.name);
    if (c) (carrierNodes[c] = carrierNodes[c] || []).push(p.disp);
  });
  const AUTO = "⚡ Auto Speed", FAIL = "🔁 Failover", DIRECT = "🇨🇳 Direct", TOP = "🚀 " + brand;
  const CI = { Telecom: "📡", Unicom: "📶", Mobile: "📱" };
  const CN = { Telecom: "电信", Unicom: "联通", Mobile: "移动" };
  const cgroup = (c) => `${CI[c] || ""} ${CN[c] || c}专线`;

  const L = [];
  L.push(`# ${brand} — generated for your account (live quota below)`);
  if (status) L.push("# " + status);
  L.push(`# ${names.length} nodes · CN-optimized: auto speed-test, fallback, carrier lines, CN-direct rules`);
  L.push(`# refreshed ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`);
  L.push("mixed-port: 7890");
  L.push("allow-lan: false");
  L.push("mode: rule");
  L.push("log-level: info");
  L.push("external-controller: 127.0.0.1:9090");
  L.push("unified-delay: true");
  L.push("dns:");
  L.push("  enable: true");
  L.push("  enhanced-mode: fake-ip");
  L.push("  fake-ip-range: 198.18.0.1/16");
  L.push("  default-nameserver: [223.5.5.5, 119.29.29.29]");
  L.push("  nameserver: [223.5.5.5, 119.29.29.29]");
  L.push("  fallback: [tls://8.8.8.8:853, tls://1.1.1.1:853]");
  L.push("  fallback-filter:");
  L.push("    geoip: true");
  L.push("    geoip-code: CN");
  L.push("proxy-groups:");
  const topMembers = [AUTO, FAIL, DIRECT, ...Object.keys(carrierNodes).map(cgroup), ...names];
  L.push(`- name: ${yq(TOP)}`);
  L.push("  type: select");
  L.push("  proxies:");
  for (const n of topMembers) L.push("  - " + yq(n));
  L.push(`- name: ${yq(AUTO)}`);
  L.push("  type: url-test");
  L.push("  url: http://www.gstatic.com/generate_204");
  L.push("  interval: 300");
  L.push("  tolerance: 80");
  L.push("  proxies:");
  for (const n of names) L.push("  - " + yq(n));
  L.push(`- name: ${yq(FAIL)}`);
  L.push("  type: fallback");
  L.push("  url: http://www.gstatic.com/generate_204");
  L.push("  interval: 300");
  L.push("  proxies:");
  for (const n of names) L.push("  - " + yq(n));
  for (const c of Object.keys(carrierNodes).sort()) {
    L.push(`- name: ${yq(cgroup(c))}`);
    L.push("  type: select");
    L.push("  proxies:");
    L.push("  - " + yq(AUTO));
    for (const n of carrierNodes[c]) L.push("  - " + yq(n));
  }
  L.push(`- name: ${yq(DIRECT)}`);
  L.push("  type: select");
  L.push("  proxies: [DIRECT, REJECT]");
  L.push("rules:");
  L.push("  - GEOIP,PRIVATE,DIRECT");
  L.push("  - DOMAIN-SUFFIX,cn,DIRECT");
  L.push("  - GEOIP,CN,DIRECT");
  L.push("  - MATCH," + yq(TOP));
  L.push("proxies:");
  for (const p of branded) {
    L.push("- name: " + yq(p.disp));
    L.push("  type: vless");
    L.push("  server: " + p.server);
    L.push("  port: " + p.port);
    L.push("  uuid: " + p.uuid);
    L.push("  network: " + p.net);
    L.push("  udp: true");
    if (p.security === "tls" || p.security === "reality") L.push("  tls: true");
    if (p.flow) L.push("  flow: " + p.flow);
    if (p.sni) L.push("  servername: " + p.sni);
    if (p.fp) L.push("  client-fingerprint: " + p.fp);
    if (p.net === "ws") {
      L.push("  ws-opts:");
      if (p.path) L.push("    path: " + p.path);
      if (p.ws_host) {
        L.push("    headers:");
        L.push("      Host: " + p.ws_host);
      }
    }
    if (p.security === "reality") {
      L.push("  reality-opts:");
      if (p.pbk) L.push("    public-key: " + p.pbk);
      if (p.sid) L.push("    short-id: " + p.sid);
    }
  }
  return L.join("\n") + "\n";
}

function quotaSummary(status) {
  const m = status.match(/↑:([\d.]+)GB,↓:([\d.]+)GB,TOT:([\d.]+)GB.*?Expires:([\d-]+)/);
  if (!m) return null;
  const up = parseFloat(m[1]), down = parseFloat(m[2]), tot = parseFloat(m[3]);
  return { up, down, tot, left: Math.max(tot - up - down, 0), exp: m[4] };
}

// ---------------- HTML ----------------
const CSS = `:root{--bg:#0b1220;--card:#141d31;--card2:#0e1626;--line:rgba(148,163,184,.14);--text:#e8eef8;--dim:#8ea0ba;--green:#34d399;--blue:#60a5fa}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;background:radial-gradient(1100px 500px at 50% -120px,rgba(37,99,235,.28),transparent),var(--bg);color:var(--text);display:flex;justify-content:center;align-items:flex-start;padding:28px 16px;min-height:100vh}
.card{background:linear-gradient(180deg,#17233c,#121a2c);border:1px solid var(--line);border-radius:22px;padding:24px;max-width:460px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.55);margin-top:12px}
h1{font-size:22px;margin:0 0 6px;font-weight:800;letter-spacing:.2px;text-align:center}
.sub{color:var(--dim);font-size:13px;text-align:center;margin:4px 0 16px;line-height:1.5}
.big{font-size:42px;font-weight:800;text-align:center;margin:12px 0 2px;background:linear-gradient(90deg,#34d399,#60a5fa);-webkit-background-clip:text;background-clip:text;color:transparent}
.big span{font-size:17px;font-weight:600;color:var(--dim);-webkit-text-fill-color:var(--dim)}
.bar{height:12px;background:#0c1424;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:14px 0 16px}
.fill{height:100%;background:linear-gradient(90deg,#34d399,#60a5fa)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.grid div{background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.grid b{display:block;font-size:16px}
.grid span{font-size:12px;color:var(--dim)}
.exp{margin-top:12px;color:#fbbf24;font-size:14px;text-align:center;font-weight:700}
.btn{display:block;margin-top:10px;background:linear-gradient(90deg,#2563eb,#4f46e5);color:#fff;text-decoration:none;border:0;cursor:pointer;padding:13px;border-radius:11px;font-size:15px;text-align:center;font-weight:700;width:100%}
.btn.gray{background:#1b2740;border:1px solid var(--line);color:var(--text)}
.btn.green{background:linear-gradient(90deg,#059669,#10b981)}
label{display:block;font-size:14px;margin:12px 0 6px;color:#cbd5e1;font-weight:600}
input[type=text],textarea{width:100%;background:var(--card2);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:12px;font-size:15px;outline:none}
textarea{height:110px;resize:vertical}
input[type=submit]{width:100%;margin-top:14px;background:linear-gradient(90deg,#059669,#10b981);color:#fff;font-weight:800;border:0;padding:14px;border-radius:11px;font-size:16px;cursor:pointer}
.me{background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:12px 13px;margin-top:10px}
.me .t{font-size:13px;color:var(--dim);margin-bottom:6px;line-height:1.5}
.me .u{font-size:13px;word-break:break-all;color:var(--blue);line-height:1.5}
.err{color:#f87171;font-size:15px;text-align:center;line-height:1.6;margin:10px 0}
.dim{color:var(--dim);font-size:12px;margin-top:14px;text-align:center;line-height:1.6}
.ok{color:var(--green);font-size:13px;text-align:center;margin-top:8px;font-weight:600}
.row{border-top:1px solid var(--line);margin-top:16px;padding-top:14px}
.msg{font-size:13px;color:#cdd8e8;background:var(--card2);border-radius:10px;padding:12px;line-height:1.65;white-space:pre-wrap}
.steps{margin-top:16px;font-size:14px;line-height:1.85;color:#cbd5e1}`;

const page = (title, body, refresh) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${refresh ? '<meta http-equiv="refresh" content="60">' : ""}
<title>${title}</title><style>${CSS}</style></head><body><div class="card">${body}</div></body></html>`;

const COPY_JS = `<script>function cp(id,ok){var t=document.getElementById(id).textContent.trim();
function d(){document.getElementById(ok).style.display='block'}
if(navigator.clipboard){navigator.clipboard.writeText(t).then(d)}
else{var x=document.createElement('textarea');x.value=t;document.body.appendChild(x);x.select();document.execCommand('copy');x.remove();d()}}
function cm(k,ok){var el=document.getElementById(k);el.style.display='block';var t=el.textContent;
function d(){document.getElementById(ok).style.display='block'}
if(navigator.clipboard){navigator.clipboard.writeText(t).then(d)}
else{var x=document.createElement('textarea');x.value=t;document.body.appendChild(x);x.select();document.execCommand('copy');x.remove();d()}}</script>`;

const homePage = () => page("Check your data", `
<h1>⚡ SP VPN — check your data</h1>
<div class="sub">paste your subscription link · 10 seconds</div>
<form method="post" action="/">
<label>Your subscription link (the one you use in Shadowrocket)</label>
<textarea name="link" placeholder="Paste your subscription link here"></textarea>
<input type="submit" value=" Show my quota">
</form>
<div class="steps">1️⃣ Paste the link your seller gave you<br>2️⃣ Tap <b>Show my quota</b><br>3️⃣ You'll get <b>your own personal link</b> — save it. Next time you just tap it.</div>`);

const formPage = (title, sub, action, btn) => page(title, `
<h1>⚡ ${title}</h1>
<div class="sub">${sub}</div>
<form method="post" action="${action}">
<label>Brand name (shown on every node &amp; link)</label>
<input type="text" name="brand" value="SP VPN" maxlength="40">
<label>Supplier link(s) — one per line (up to 20)</label>
<textarea name="links" placeholder="https://provider.example/api/sub?token=…"></textarea>
<input type="submit" value="${btn}">
</form>
<div class="steps">For each link you get: ✨ the ONE link (any app) · 🔗 live quota link · 📋 ready-to-send message</div>`);

const errorPage = (msg) => page("Error", `
<h1>⚡ SP VPN</h1>
<div class="err">${msg}</div>
<a class="btn" href="/">← Back</a>
<div class="dim">If your plan was renewed, use the NEW link.</div>`);

function quotaBody(host, tok, brand, status, proxies, linksTotal) {
  const s = quotaSummary(status);
  const one = `${host}/all/${encodeURIComponent(brand)}?t=${encodeURIComponent(tok)}`;
  const sub = `${host}/sub/${encodeURIComponent(tok)}?brand=${encodeURIComponent(brand)}`;
  let quota;
  if (s) {
    const pct = Math.min(100, ((s.tot - s.left) / s.tot) * 100);
    quota = `<div class="big">${s.left.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} <span>GB left</span></div>
<div class="bar"><div class="fill" style="width:${pct.toFixed(1)}%"></div></div>
<div class="grid">
  <div><b>${s.tot.toFixed(0)} GB</b><span>total plan</span></div>
  <div><b>${(s.up + s.down).toFixed(2)} GB</b><span>used</span></div>
  <div><b>↑ ${s.up.toFixed(2)} GB</b><span>uploaded</span></div>
  <div><b>↓ ${s.down.toFixed(2)} GB</b><span>downloaded</span></div>
</div>
<div class="exp">💡 Expires: ${s.exp}</div>`;
  } else {
    quota = `<div class="err">Quota text not recognized.<br>${status || "No status from provider."}</div>`;
  }
  return `
<h1>⚡ ${brand} — your data</h1>
<div class="sub">updated ${new Date().toISOString().slice(11, 16)} UTC · auto-refreshes every 60s</div>
${quota}
<div class="dim" style="text-align:center;margin-top:10px">${proxies.length} of ${linksTotal} nodes ready</div>
<div class="me"><div class="t">🔗 <b>YOUR personal link</b> — save it:</div><div class="u" id="pl">${one}</div></div>
<button class="btn gray" style="margin-top:8px" onclick="cp('pl','cop1')">📋 Copy my personal link</button>
<div class="ok" id="cop1" style="display:none">✅ copied</div>
<div class="me" style="margin-top:14px"><div class="t">✨ <b>ONE VPN LINK — all apps</b> (Shadowrocket / v2rayNG / Clash / Hiddify — auto-detects, named "${brand}", English node names):</div><div class="u" id="al">${one}</div></div>
<button class="btn green" style="margin-top:8px" onclick="cp('al','copa')">📋 Copy the ONE link</button>
<div class="ok" id="copa" style="display:none">✅ copied — that's all your client needs</div>
<div class="me" style="margin-top:14px"><div class="t">🔄 <b>Clash auto-update</b> (Verge/Fugu): Profiles → New → remote URL:</div><div class="u" id="su">${sub}</div></div>
<button class="btn gray" style="margin-top:8px" onclick="cp('su','cop2')">📋 Copy Clash link</button>
<div class="ok" id="cop2" style="display:none">✅ copied</div>
${COPY_JS}`;
}

function rebrandResults(host, brand, rows) {
  const parts = [`<h1>⚡ Rebranded as ${brand}</h1><div class="sub">${rows.length} link(s) · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</div>`];
  rows.forEach((r, i) => {
    const n = i + 1;
    if (r.error) { parts.push(`<div class="row"><b>Link ${n}</b><div class="err">❌ ${r.error}</div></div>`); return; }
    const one = `${host}/all/${encodeURIComponent(brand)}?t=${encodeURIComponent(r.tok)}`;
    parts.push(`<div class="row"><b>Link ${n} — ${r.proxies.length} nodes</b>
${r.summary ? `<div class="dim" style="text-align:center">🚀 ${r.summary.left.toFixed(2)} GB left · expires ${r.summary.exp}</div>` : ""}
<div class="me"><div class="t">✨ <b>ONE LINK — works in all apps</b> (Shadowrocket, v2rayNG, NekoBox, Hiddify, Clash):</div><div class="u" id="al${n}">${one}</div></div>
<div class="me"><div class="t">🔗 <b>Client's private quota</b> link (live GB, auto-refresh):</div><div class="u" id="pl${n}">${one}</div></div>
<div style="display:flex;gap:8px">
<button class="btn green" style="flex:1;margin-top:8px" onclick="cp('al${n}','cosp${n}')">📋 Copy one link</button>
<button class="btn gray" style="flex:1;margin-top:8px" onclick="cp('pl${n}','cosp2${n}')">📋 Copy quota link</button>
</div>
<div class="ok" id="cosp${n}" style="display:none">✅ copied</div>
<div class="ok" id="cosp2${n}" style="display:none">✅ copied</div></div>`);
  });
  parts.push(COPY_JS);
  return page(`Rebranded as ${brand}`, parts.join(""));
}

function toolResults(host, brand, rows) {
  const parts = [`<h1>⚡ ${brand} — client packs</h1><div class="sub">${rows.length} link(s) · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</div>`];
  rows.forEach((r, i) => {
    const n = i + 1;
    if (r.error) { parts.push(`<div class="row"><b>Link ${n}</b><div class="err">❌ ${r.error}</div></div>`); return; }
    const one = `${host}/all/${encodeURIComponent(brand)}?t=${encodeURIComponent(r.tok)}`;
    const sub = `${host}/sub/${encodeURIComponent(r.tok)}?brand=${encodeURIComponent(brand)}`;
    const msg = `Here's your ${brand} setup 🚀

1) VPN — add this ONE link in your app (Shadowrocket / v2rayNG / NekoBox / Hiddify / Clash — auto-detects, arrives named "${brand}"):
${one}
   Clash (Verge/Fugu) users — use this instead, it auto-updates:
${sub}

2) Check your data anytime (live):
${one}

If your plan renews: open ${one} and paste your new subscription link.`;
    parts.push(`<div class="row"><b>Link ${n} — ${r.proxies.length} nodes</b>
${r.summary ? `<div class="dim" style="text-align:center">🚀 ${r.summary.left.toFixed(2)} GB left · expires ${r.summary.exp}</div>` : ""}
<div class="me"><div class="t">✨ <b>ONE LINK — all apps</b>:</div><div class="u" id="al${n}">${one}</div></div>
<div class="me"><div class="t">🔄 <b>Clash auto-update</b> link:</div><div class="u" id="su${n}">${sub}</div></div>
<div class="me"><div class="t">🔗 <b>Client's private quota</b> link:</div><div class="u" id="pl${n}">${one}</div></div>
<button class="btn" onclick="cm('m${n}','copm${n}')">📋 Copy ready-to-send message</button>
<div class="msg" id="m${n}" style="display:none">${msg.replace(/</g, "&lt;")}</div>
<div class="ok" id="copm${n}" style="display:none">✅ message copied — send it to your client</div></div>`);
  });
  parts.push(COPY_JS);
  return page(`${brand} — client packs`, parts.join(""));
}

// ---------------- router ----------------
async function collectRows(brand, linksText, host) {
  const links = linksText.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l.startsWith("http://") || l.startsWith("https://") || /^[a-z0-9+.-]+:\/\//i.test(l)).slice(0, 20);
  const rows = [];
  for (const link of links) {
    const isNodeLink = !/^https?:\/\//i.test(link);
    const key = isNodeLink ? "direct:" + link : link;
    const tok = b64e(key);
    try {
      if (isNodeLink) {
        const ns = link.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const proxies = ns.map(parseVless).filter(Boolean);
        if (!proxies.length) { rows.push({ tok, error: "link contained no nodes" }); continue; }
        rows.push({ tok, status: "", proxies, summary: null, linksTotal: ns.length });
      } else {
        const { status, links: ls } = await fetchSubscription(link);
        if (!ls.length) { rows.push({ tok, error: "link opened but contained no nodes" }); continue; }
        const proxies = ls.map(parseVless).filter(Boolean);
        rows.push({ tok, status, proxies, summary: quotaSummary(status), linksTotal: ls.length });
      }
    } catch (e) {
      rows.push({ tok, error: "could not read link (" + e.message + ")" });
    }
  }
  return rows;
}

// ---------------- data (with 5-min cache to protect the supplier) ----------------
const _cache = new Map();
const TTL = 300000;

async function getDecoded(tok) {
  const hit = _cache.get(tok);
  if (hit && Date.now() - hit.t < TTL) return hit.d;
  let d;
  const url = b64d(tok);
  if (url.startsWith("direct:")) {
    const ns = url.slice(7).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    d = { status: "", links: ns, proxies: ns.map(parseVless).filter(Boolean) };
  } else {
    const { status, links } = await fetchSubscription(url);
    d = { status, links, proxies: links.map(parseVless).filter(Boolean) };
  }
  _cache.set(tok, { t: Date.now(), d });
  return d;
}

const html = (doc, title) => {
  const t = String(doc).trimStart();
  const isFull = t.startsWith("<!doctype") || t.startsWith("<html");
  const out = isFull ? doc : page(title || "SP VPN", doc);
  return new Response(out, { headers: { "Content-Type": "text/html; charset=utf-8" } });
};
const plain = (body, extra) => new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", ...extra } });
const yamlRes = (body) => new Response(body, { headers: { "Content-Type": "text/yaml; charset=utf-8" } });

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const host = `${request.headers.get("x-forwarded-proto") || "https"}://${url.host}`;

      if (request.method === "POST") {
        const data = Object.fromEntries(new URLSearchParams(await request.text()));
        const brand = (data.brand || "SP VPN").trim().slice(0, 40) || "SP VPN";
        if (path === "/rebrand" || path === "/tool") {
          const rows = await collectRows(brand, data.links || "", host);
          if (!rows.length) return html(errorPage("No valid links found — paste the subscription URL your supplier gave you (starts with http or https)"));
          return html((path === "/tool" ? toolResults : rebrandResults)(host, brand, rows));
        }
        if (path === "/") {
          const link = (data.link || "").trim();
          if (!link) return html(homePage());
          if (!/^https?:\/\//i.test(link)) return html(errorPage("That doesn't look like a link — it should start with http or https."));
          await fetchSubscription(link);
          return new Response(null, { status: 302, headers: { Location: "/q/" + b64e(link) } });
        }
        return html(errorPage("Not found"));
      }

      // GET
      if (path === "/healthz") return plain("ok");
      if (path === "/") return html(homePage());
      if (path === "/rebrand") return html(formPage("Link Rebranding", "paste supplier link → get your ONE link", "/rebrand", "✨ Rebrand link(s)"));
      if (path === "/tool") return html(formPage("Seller Tool", "full client packs — links for every app, quota & message", "/tool", "⚡ Generate client packs"));

      let m;
      if ((m = path.match(/^\/q\/([^/]+)$/))) {
        const brand = url.searchParams.get("brand") || "SP VPN";
        const { status, proxies, links } = await getDecoded(m[1]);
        return html(quotaBody(host, m[1], brand, status, proxies, links.length));
      }
      if ((m = path.match(/^\/all\/([^/?]+)$/))) {
        const brand = safeDecode(m[1]) || "SP VPN";
        const tok = url.searchParams.get("t") || "";
        if (!tok) return plain("missing ?t= parameter");
        const { status, links, proxies } = await getDecoded(tok);
        if (!links.length) return plain("No nodes found in that link.");
        const ua = (request.headers.get("user-agent") || "").toLowerCase();
        if (["clash", "mihomo", "fugu", "streisand", "nyanpasu"].some((k) => ua.includes(k))) {
          if (!proxies.length) return plain("Clash needs VLESS nodes; none found in this link.");
          return yamlRes(buildYaml(status, proxies, brand));
        }
        return plain(btoa(unescape(encodeURIComponent(buildShare(status, links, brand)))));
      }
      if ((m = path.match(/^\/sub\/([^/]+)$/))) {
        const brand = url.searchParams.get("brand") || "SP VPN";
        const { status, proxies } = await getDecoded(m[1]);
        if (!proxies.length) return plain("No VLESS nodes found in that link.");
        return yamlRes(buildYaml(status, proxies, brand));
      }
      if ((m = path.match(/^\/share\/([^/]+)$/))) {
        const brand = url.searchParams.get("brand") || "SP VPN";
        const { status, links } = await getDecoded(m[1]);
        if (!links.length) return plain("No nodes found in that link.");
        const body = buildShare(status, links, brand);
        if (url.searchParams.get("file") === "1")
          return plain(body, { "Content-Disposition": `attachment; filename="${(brand.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}.txt"` });
        return plain(body);
      }
      if ((m = path.match(/^\/sr\/([^/?]+)$/))) {
        const brand = safeDecode(m[1]) || "SP VPN";
        const tok = url.searchParams.get("t") || "";
        if (!tok) return plain("missing ?t= parameter");
        const { status, links } = await getDecoded(tok);
        if (!links.length) return plain("No nodes found in that link.");
        return plain(btoa(unescape(encodeURIComponent(buildShare(status, links, brand)))));
      }
      return html(errorPage("Not found"));
    } catch (e) {
      return html(errorPage("Couldn't read that link — it may be invalid or expired.<br>(" + String(e.message).replace(/</g, "&lt;") + ")"));
    }
  },
};
