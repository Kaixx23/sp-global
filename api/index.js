// SP VPN — Vercel entry (all routes rewrite to /api/index via vercel.json)
import worker from "../sp-vpn-worker.js";

export default async function handler(req, res) {
  let body = null;
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => resolve(data));
    });
  }
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const url = `${proto}://${req.headers.host}${req.url}`;
  const request = new Request(url, { method: req.method, headers: new Headers(req.headers), body });
  const response = await worker.fetch(request, {}, {});
  res.statusCode = response.status;
  const headers = {};
  response.headers.forEach((v, k) => {
    if (!["content-length", "transfer-encoding", "connection", "date"].includes(k)) headers[k] = v;
  });
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(await response.text());
}
