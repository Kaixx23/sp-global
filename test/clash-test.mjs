// End-to-end test of the ONE link against Clash Verge / Clash Meta / v2rayNG behavior.
// Validates the generated YAML the way mihomo does at startup (mihomo can't be
// downloaded in this sandbox, so its fatal rules are re-implemented here):
//   1. YAML must parse
//   2. no duplicate proxy names            ("proxy %s is the duplicate name")
//   3. no duplicate group names            ("proxy group %s: the duplicate name")
//   4. no proxy name colliding with a group name
//   5. every group member must exist
//   6. groups must be non-empty
//   7. every proxy has name/type/server/port(+uuid|password)
import worker from "../sp-vpn-worker.js";
let yaml = null;
try {
  const { load } = await import("/tmp/validate/node_modules/js-yaml/dist/js-yaml.mjs")
    .catch(() => import("js-yaml"));
  yaml = { load };
} catch (e) {
  console.log("⚠️  js-yaml not found — run `npm i js-yaml` in a scratch dir to enable YAML validation");
}
if (!yaml) process.exit(2);

let failures = 0;
const ok = (cond, msg) => {
  console.log((cond ? "  ✅" : "  ❌") + " " + msg);
  if (!cond) failures++;
};

// ---- supplier fixture: the nastiest realistic airport sub ----
const vmessNode = "vmess://" + btoa(unescape(encodeURIComponent(JSON.stringify({
  v: "2", ps: "韩国•联通01", add: "kr1.example.com", port: "443", id: "aaaabbbb-cccc-4ddd-8eee-ffffffffffff",
  aid: "0", scy: "auto", net: "ws", host: "kr1.example.com", path: "/vmws", tls: "tls", sni: "kr1.example.com", fp: "chrome",
}))));
const SUPPLIER_NODES = [
  "STATUS=↑:1.23GB,↓:45.67GB,TOT:200GB Expires:2027-01-01",
  // NAME COLLISION pair: 移联01 vs 移动01 -> both "Hong Kong•Mobile01"
  "vless://8f2a9d3e-1111-4b2c-9d4e-aaaaaaaaaaaa@hk1.example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=Xy3k9qP2mZ8sL4vN7cQ1wE6rT5yU0iO9pA3sD2fG8hI%3D&sid=6a1b&type=tcp&flow=xtls-rprx-vision#%E9%A6%99%E6%B8%AF%E2%80%A2%E7%A7%BB%E8%81%9401",
  "vless://8f2a9d3e-2222-4b2c-9d4e-bbbbbbbbbbbb@hk2.example.com:443?encryption=none&security=reality&sni=www.apple.com&fp=chrome&pbk=Xy3k9qP2mZ8sL4vN7cQ1wE6rT5yU0iO9pA3sD2fG8hI%3D&sid=0&type=tcp&flow=xtls-rprx-vision#%E9%A6%99%E6%B8%AF%E2%80%A2%E7%A7%BB%E5%8A%A801",
  // grpc + reality
  "vless://8f2a9d3e-4444-4b2c-9d4e-dddddddddddd@sg1.example.com:443?encryption=none&security=reality&sni=sg1.example.com&fp=chrome&pbk=ZGVmc9D2fG8hI%3D&sid=aabb&type=grpc&serviceName=grpc-svc&flow=xtls-rprx-vision#%E6%96%B0%E5%8A%A0%E5%9D%A1%E2%80%A2%E7%94%B5%E4%BF%A101",
  // ws + tls
  "vless://8f2a9d3e-3333-4b2c-9d4e-cccccccccccc@jp1.example.com:8443?encryption=none&security=tls&sni=jp1.example.com&fp=chrome&type=ws&host=jp1.example.com&path=%2Fws%3Fed%3D2048#%E6%97%A5%E6%9C%AC%E2%80%A2%E7%A7%BB%E8%81%9401",
  // plain tcp tls
  "vless://8f2a9d3e-5555-4b2c-9d4e-eeeeeeeeeeee@us1.example.com:443?encryption=none&type=tcp&security=tls#%E7%BE%8E%E5%9B%BD%E2%80%A2%E7%94%B5%E4%BF%A101",
  // trojan + ws
  "trojan://pass%40word@tw1.example.com:443?security=tls&sni=tw1.example.com&type=ws&host=tw1.example.com&path=%2Ftr#%E5%8F%B0%E6%B9%BE%E2%80%A2%E5%AE%B6%E5%AE%BD1",
  // vmess + ws + tls
  vmessNode,
  // IPv6 server
  "vless://8f2a9d3e-8888-4b2c-9d4e-121212121212@[2001:db8::5]:443?encryption=none&security=tls&type=tcp#%E8%8B%B1%E5%9B%BD01",
  // stray "%" in the name — used to crash sortForCN (all apps got an error page)
  "vless://8f2a9d3e-9999-4b2c-9d4e-131313131313@de1.example.com:443?encryption=none&security=tls&type=tcp#%E5%BE%B7%E5%9B%BD50%off",
  // quota placeholder node (fake server)
  "vless://00000000-0000-0000-0000-000000000000@1.1.1.1:80?encryption=none&type=tcp#%E5%89%A9%E4%BD%99%E6%B5%81%E9%87%8F%EF%BC%9A150GB",
];

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).startsWith("https://supplier.example/sub")) {
    // first attempt always fails -> exercises the retry path too
    if (!globalThis._calledOnce) { globalThis._calledOnce = true; return new Response("403 forbidden", { status: 403 }); }
    return new Response(SUPPLIER_NODES.join("\n") + "\n");
  }
  return realFetch(url, opts);
};

const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tok = b64e("https://supplier.example/sub?token=abc");
globalThis._calledOnce = false;

async function run(path, ua) {
  const res = await worker.fetch(new Request("https://sp.example.com" + path, { headers: ua ? { "User-Agent": ua } : {} }), {}, {});
  return { status: res.status, ct: res.headers.get("content-type"), ui: res.headers.get("subscription-userinfo"), body: await res.text() };
}

// ============ 1. What Clash Verge receives ============
console.log("\n[1] /all with clash-verge UA (what Clash Verge imports):");
const verge = await run(`/all/SP%20VPN?t=${tok}`, "clash-verge/v2.2.3");
ok(verge.status === 200, `HTTP 200 (got ${verge.status})`);
ok((verge.ct || "").includes("yaml"), `Content-Type yaml (got ${verge.ct})`);
ok(/upload=\d+; download=\d+; total=\d+; expire=\d+/.test(verge.ui || ""), `subscription-userinfo header present (${verge.ui})`);

let cfg = null;
try { cfg = yaml.load(verge.body); } catch (e) { ok(false, "YAML parses: " + e.message); }
if (cfg) {
  ok(true, "YAML parses");
  const proxies = cfg.proxies || [], groups = cfg["proxy-groups"] || [];
  const pnames = proxies.map((p) => p.name);
  const gnames = groups.map((g) => g.name);
  ok(new Set(pnames).size === pnames.length, `no duplicate proxy names (mihomo fatal) — got ${pnames.length}: ${JSON.stringify(pnames)}`);
  ok(new Set(gnames).size === gnames.length, "no duplicate group names");
  ok(pnames.every((n) => !gnames.includes(n) && !["DIRECT", "REJECT", "GLOBAL"].includes(n)), "no proxy/group name collisions");
  const exist = new Set([...pnames, ...gnames, "DIRECT", "REJECT", "REJECT-DROP", "PASS", "PASS-RULE", "COMPATIBLE", "GLOBAL"]);
  ok(groups.every((g) => g.proxies && g.proxies.length > 0), "all groups non-empty");
  ok(groups.every((g) => g.proxies.every((m) => exist.has(m))), "all group members exist");
  ok(proxies.every((p) => p.server && p.port && p.type), "every proxy has server/port/type");
  const hk1 = proxies.find((p) => p.server === "hk1.example.com");
  const hk2 = proxies.find((p) => p.server === "hk2.example.com");
  ok(hk1 && hk2 && hk1.name !== hk2.name, `collision pair renamed apart: "${hk1?.name}" vs "${hk2?.name}"`);
  ok(hk1?.["reality-opts"]?.["public-key"] && hk1?.["client-fingerprint"], "reality node keeps pbk + fingerprint");
  const sg = proxies.find((p) => p.server === "sg1.example.com");
  ok(sg?.["grpc-opts"]?.["grpc-service-name"] === "grpc-svc", "grpc node keeps its service name (was: silently dropped)");
  const tw = proxies.find((p) => p.server === "tw1.example.com");
  ok(tw?.type === "trojan" && tw?.password === "pass@word" && tw?.["ws-opts"]?.headers?.Host, "trojan node emitted with password + ws host");
  const kr = proxies.find((p) => p.server === "kr1.example.com");
  ok(kr?.type === "vmess" && kr?.cipher === "auto" && kr?.["ws-opts"]?.path === "/vmws" && kr?.tls === true, "vmess node emitted (was: dropped entirely)");
  const v6 = proxies.find((p) => p.server === "2001:db8::5");
  ok(!!v6, "IPv6 server parsed");
  const de = proxies.find((p) => p.server === "de1.example.com");
  ok(!!de, `name with stray "%" didn't crash (node kept: ${de?.name})`);
  ok(proxies.some((p) => /Remaining/.test(p.name)), "quota placeholder node kept as visible entry");
  const auto = groups.find((g) => g.name.includes("Auto Speed"));
    ok(auto && !auto.proxies.some((n) => /Remaining/.test(n)), "quota placeholder NOT in url-test group");
  ok(!verge.body.includes("external-controller"), "no hardcoded external-controller (breaks Verge's own controller)");
  ok(Array.isArray(cfg.rules) && cfg.rules.length > 0, "rules present");
}

// ============ 2. Other Clash-family UAs ============
console.log("\n[2] Other apps get YAML too:");
for (const ua of ["ClashMetaForAndroid/2.11.5", "mihomo/1.19.0", "clash.meta", "ClashX/1.118.0", "FlClash/0.8.76", "Stash/3.2.0"]) {
  const r = await run(`/all/SP%20VPN?t=${tok}`, ua);
  ok(r.status === 200 && (r.ct || "").includes("yaml"), `${ua} → YAML (${r.status})`);
}

// ============ 3. v2rayNG / Shadowrocket / Hiddify get base64 ============
console.log("\n[3] v2ray-family apps get base64 SR format:");
for (const ua of ["v2rayNG/1.9.16", "v2rayN/6.60", "Shadowrocket/2.2.32", "HiddifyNext/2.5.1", "NekoBox/1.3.9"]) {
  const r = await run(`/all/SP%20VPN?t=${tok}`, ua);
  let decoded = "";
  try { decoded = decodeURIComponent(escape(atob(r.body.trim()))); } catch (e) {}
  ok(r.status === 200 && decoded.includes("vless://") && decoded.includes("trojan://"), `${ua} → base64 with nodes`);
}
const v2 = await run(`/all/SP%20VPN?t=${tok}`, "v2rayNG/1.9.16");
const v2dec = decodeURIComponent(escape(atob(v2.body.trim())));
ok(v2dec.includes(vmessNode.split("#")[0].slice(0, 30)), "vmess link passed through untouched for v2ray apps");
ok(v2.ui && v2.ui.includes("expire="), "v2rayNG sees subscription-userinfo (expiry shown in app)");

// ============ 4. /sub Clash auto-update URL ============
console.log("\n[4] /sub (Clash Verge auto-update profile):");
const sub = await run(`/sub/${tok}?brand=SP%20VPN`, "clash-verge/v2.2.3");
ok(sub.status === 200 && (sub.ct || "").includes("yaml"), `YAML (${sub.status})`);
let subCfg = null;
try { subCfg = yaml.load(sub.body); } catch (e) {}
ok(!!subCfg && new Set((subCfg.proxies || []).map((p) => p.name)).size === (subCfg.proxies || []).length, "no duplicate names");

// ============ 5. Error paths return real HTTP errors ============
console.log("\n[5] Failure modes:");
const badTok = b64e("https://supplier.example/broken"); // always 403
globalThis.fetch = async () => new Response("403 forbidden", { status: 403 });
const err = await run(`/all/SP%20VPN?t=${badTok}`, "clash-verge/v2.2.3");
ok(err.status >= 500, `supplier blocked → HTTP ${err.status} (was 200 HTML that apps tried to parse)`);
ok(!err.body.includes("<html"), "error body is plain text, not HTML");
const noTok = await run(`/all/SP%20VPN`, "clash-verge/v2.2.3");
ok(noTok.status === 400, `missing t → HTTP ${noTok.status}`);
const ssOnly = b64e("https://supplier.example/ssonely");
globalThis.fetch = async () => new Response("ss://YWVzLTI1Ni1nY206cGFzcw==@1.2.3.4:8388#test\n");
const ss = await run(`/all/SP%20VPN?t=${ssOnly}`, "clash-verge/v2.2.3");
ok(ss.status === 502 && /trojan/i.test(ss.body), `unsupported-node link → clear 502 message: ${ss.body.trim().slice(0, 70)}`);

// ============ 6. Direct node-link paste (POST /rebrand flow) still works ============
console.log("\n[6] Seller flows:");
const form = new URLSearchParams({ brand: "SP VPN", links: "https://supplier.example/sub?token=abc" }).toString();
globalThis._calledOnce = true;
globalThis.fetch = async (url) => new Response(SUPPLIER_NODES.join("\n") + "\n");
const post = await worker.fetch(new Request("https://sp.example.com/rebrand", { method: "POST", body: form }), {}, {});
const postBody = await post.text();
ok(post.status === 200 && postBody.includes("ONE LINK"), "POST /rebrand works");

console.log(`\n${failures === 0 ? "🎉 ALL TESTS PASSED" : "💥 " + failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
