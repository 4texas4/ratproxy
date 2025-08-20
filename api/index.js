// Plain Node serverless function for Vercel.
// Usage:
//   https://your-app.vercel.app/?url=https%3A%2F%2Fexample.com
//   https://your-app.vercel.app/?https://example.com

export default async function handler(req, res) {
  try {
    // CORS preflight support
    if (req.method === "OPTIONS") {
      setCors(res);
      return res.status(204).end();
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      setCors(res);
      return res.status(405).send("Method not allowed");
    }

    // Accept both ?url=... and the lazy format /?https://example.com
    let target = req.query.url;
    if (!target) {
      const keys = Object.keys(req.query || {});
      if (keys.length === 1 && keys[0].startsWith("http")) {
        // e.g., key = "https://example.com", value = "" (or undefined)
        target = keys[0];
      }
    }

    if (!target) {
      setCors(res);
      return res
        .status(400)
        .send(
          "Usage: /?url=https%3A%2F%2Fexample.com  or  /?https://example.com"
        );
    }

    // Basic safety checks
    const forbiddenSchemes = /^(?:about:|chrome:|file:|data:|vbscript:|javascript:)/i;
    if (forbiddenSchemes.test(target)) {
      setCors(res);
      return res.status(400).send("Disallowed URL scheme");
    }

    // Prevent accidental proxy loops
    const host = (req.headers.host || "").toLowerCase();
    if (target.toLowerCase().includes(host)) {
      setCors(res);
      return res.status(400).send("Refusing to proxy to self");
    }

    // Fetch the target
    const upstream = await fetch(target, {
      method: "GET",
      headers: {
        // Pass through some harmless headers to look like a browser
        "User-Agent":
          req.headers["user-agent"] ||
          "Mozilla/5.0 (compatible; Vercel-CORS-Proxy/1.0)",
        Accept: req.headers["accept"] || "*/*",
        "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9"
      },
      redirect: "follow",
      cache: "no-store"
    });

    // Mirror status
    res.status(upstream.status);

    // Mirror headers (minus hop-by-hop & restrictive policies)
    const blockedHeaders = new Set([
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailers",
      "transfer-encoding",
      "upgrade",
      // Strip policies that commonly break embedding/consumption across origins
      "content-security-policy",
      "content-security-policy-report-only",
      "x-frame-options",
      "strict-transport-security",
      "report-to",
      "nel",
      "cross-origin-opener-policy",
      "cross-origin-embedder-policy",
      "cross-origin-resource-policy"
    ]);

    upstream.headers.forEach((value, key) => {
      if (!blockedHeaders.has(key.toLowerCase())) {
        try {
          res.setHeader(key, value);
        } catch {
          /* ignore bad header values */
        }
      }
    });

    // CORS: allow any origin to read it
    setCors(res);

    // Stream body through
    if (req.method === "HEAD" || upstream.status === 204) {
      return res.end();
    }

    // Node 18 fetch gives a web stream; convert to Node stream if needed
    if (upstream.body && typeof upstream.body.pipe === "function") {
      upstream.body.pipe(res);
    } else {
      // Fallback: buffer then send
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.end(buf);
    }
  } catch (err) {
    setCors(res);
    res.status(502).send("Proxy error: " + (err?.message || String(err)));
  }
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
}
