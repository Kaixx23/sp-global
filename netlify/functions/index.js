// SP VPN — Netlify Functions entry.
// Adapts a Netlify HTTP event to the worker's fetch(request) interface.
// All routes are rewritten to this function (see netlify.toml).
// Returns a Web Response so the streaming v2 runtime accepts the value.
import worker from "../../sp-vpn-worker.js";

const normHeaders = (headers = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
};

export default async (event) => {
  const method = (event.httpMethod || "GET").toUpperCase();
  const headers = normHeaders(event.headers);
  let body = null;
  if (["POST", "PUT", "PATCH"].includes(method)) {
    body = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "");
  }
  // event.rawUrl only exists on direct function calls; when netlify.toml
  // proxies a route to this function, rebuild the URL from the standard
  // fields (original path + querystring + Host header).
  let rawUrl = event.rawUrl;
  if (!rawUrl) {
    const proto = (headers["x-forwarded-proto"] || "https").split(",")[0];
    const host = headers["x-forwarded-host"] || headers["host"] || "localhost";
    const path = event.rawPath || event.path || "/";
    const qs = event.querystring ? "?" + event.querystring : "";
    rawUrl = `${proto}://${host}${path}${qs}`;
  }
  const request = new Request(rawUrl, { method, headers, body });
  const response = await worker.fetch(request, {}, {});
  // The streaming v2 runtime requires a Response (or undefined). Strip a few
  // hop-by-hop headers that the Lambda shim adds anyway.
  const out = new Headers();
  response.headers.forEach((v, k) => {
    if (!["content-length", "transfer-encoding", "connection", "date"].includes(k)) {
      out.set(k, v);
    }
  });
  return new Response(response.body, { status: response.status, headers: out });
};
