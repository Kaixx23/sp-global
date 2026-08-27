// Verifies the Netlify adapter under BOTH invocation styles:
//   v2 (production):  export default (request: Request, context) -> Response
//   v1 (legacy dev):  export default ({httpMethod, headers, body, ...}) -> Response
// Exercises the real converter flow end-to-end against a local mock supplier.
import fn from "../netlify/functions/index.js";

const BASE = "http://mysite.netlify.app";
let fails = 0, checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) { fails++; console.log("  ❌ " + msg); } else console.log("  ✅ " + msg);
};

// ---- mock supplier panel (like a real sub link: base64 of node lines) ----
import http from "node:http";
const NODES = [
  "vless://d342b11e-6bf0-41ca-a3f9-0f5a91c8d701@1.2.3.4:443?encryption=none&security=reality&sni=www.apple.com&fp=chrome&pbk=SbVKOEMjK0sIlbwg4akyBg5mL5CROXXcEZ2EnJxOTDE&sid=6b8&type=tcp&flow=xtls-rprx-vision#%F0%9F%87%AF%F0%9F%87%B5%20%E6%97%A5%E6%9C%AC%E2%80%A2%E7%A7%BB%E8%81%9401",
  "trojan://passw0rd@5.6.7.8:443?security=tls&sni=cdn.example.com&type=tcp#%F0%9F%87%AD%F0%9F%87%B0%20%E9%A6%99%E6%B8%AF%E2%80%A2%E7%94%B5%E4%BF%A101",
  "剩余流量：100.5 GB",
].join("\n");
const SUB_B64 = Buffer.from(NODES, "utf8").toString("base64");
const supplier = http.createServer((req, res) => { res.end(SUB_B64); });
await new Promise((r) => supplier.listen(0, "127.0.0.1", r));
const SUPPLIER = "http://127.0.0.1:" + supplier.address().port + "/sub?token=xyz";
console.log("mock supplier at " + SUPPLIER);

// ---- v2-style invocation: pass a real Request ----
const v2 = async (path, opts = {}) => {
  const req = new Request(BASE + path, opts);
  const res = await fn(req, {});
  const body = await res.text();
  return { status: res.status, headers: res.headers, body };
};
// ---- v1-style invocation: legacy event object ----
const v1 = async (path, opts = {}) => {
  const u = new URL(BASE + path);
  const event = {
    httpMethod: opts.method || "GET",
    headers: { host: u.host, "x-forwarded-proto": "http", ...(opts.headers || {}) },
    rawPath: u.pathname,
    querystring: u.searchParams.toString(),
    isBase64Encoded: false,
    body: opts.body ?? null,
  };
  const res = await fn(event, {});
  const body = await res.text();
  return { status: res.status, headers: res.headers, body };
};

let tok;
for (const [label, call] of [["v2 (Request)", v2], ["v1 (event)", v1]]) {
  console.log("\n== runtime " + label + " ==");
  let r = await call("/healthz");
  ok(r.status === 200 && r.body.trim() === "ok", "/healthz → 200 'ok' (got " + r.status + " '" + r.body.slice(0, 40).replace(/\n/g, " ") + "')");

  r = await call("/");
  ok(r.status === 200 && r.body.includes("<form"), "GET / → homepage with converter form");
  ok(/action="\/"/.test(r.body), "home form posts to /");

  // THE converter: paste supplier link on the homepage → 302 to /q/<token>
  r = await call("/", { method: "POST", body: "link=" + encodeURIComponent(SUPPLIER), headers: { "content-type": "application/x-www-form-urlencoded" } });
  ok(r.status === 302 && (r.headers.get("location") || "").startsWith("/q/"), "POST / (converter) → 302 to quota page (got " + r.status + ")");
  tok = (r.headers.get("location") || "").slice(3);

  // rebrand tool
  r = await call("/rebrand", { method: "POST", body: "brand=TestBrand&links=" + encodeURIComponent(SUPPLIER), headers: { "content-type": "application/x-www-form-urlencoded" } });
  ok(r.status === 200 && r.body.includes("/all/TestBrand?t="), "POST /rebrand → results contain one-link (got " + r.status + ")");

  // quota page
  r = await call("/q/" + tok);
  ok(r.status === 200 && r.body.includes("TestBrand") === false && r.body.length > 500, "GET /q/<token> → quota page HTML");

  // one-link, Clash UA → YAML
  r = await call("/all/SP%20VPN?t=" + tok, { headers: { "user-agent": "clash-verge/v2.0.0" } });
  ok(r.status === 200 && /proxies:/.test(r.body) && /type: vless/.test(r.body), "GET /all (Clash UA) → mihomo YAML");

  // one-link, Shadowrocket UA → base64 SR sub
  r = await call("/all/SP%20VPN?t=" + tok, { headers: { "user-agent": "Shadowrocket/2.2.32" } });
  const decoded = Buffer.from(r.body.trim(), "base64").toString("utf8");
  ok(r.status === 200 && decoded.includes("vless://") && decoded.includes("trojan://"), "GET /all (Shadowrocket UA) → base64 SR sub, links intact");

  r = await call("/share/" + tok);
  ok(r.status === 200 && r.body.includes("vless://"), "GET /share/<token> → plain node list");
}

supplier.close();
console.log("\n" + (fails ? `❌ ${fails}/${checks} checks FAILED` : `✅ all ${checks} checks passed`));
process.exit(fails ? 1 : 0);
