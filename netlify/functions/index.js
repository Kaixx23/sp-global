// SP VPN — Netlify Functions entry.
// Adapts a Netlify HTTP event to the worker's fetch(request) interface.
// All routes are rewritten to this function (see netlify.toml).
import worker from "../../sp-vpn-worker.js";

export default async (event) => {
  const method = (event.httpMethod || "GET").toUpperCase();
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) {
    headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  let body = null;
  if (["POST", "PUT", "PATCH"].includes(method)) {
    body = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "");
  }
  const request = new Request(event.rawUrl, { method, headers, body });
  const response = await worker.fetch(request, {}, {});
  const out = {};
  response.headers.forEach((v, k) => {
    if (!["content-length", "transfer-encoding", "connection", "date"].includes(k)) out[k] = v;
  });
  return { statusCode: response.status, headers: out, body: await response.text() };
};
