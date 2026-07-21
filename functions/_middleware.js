// Patternly — Cloudflare Pages Function (Tier 2: Luca·S account awareness)
//
// WHERE THIS FILE GOES: in your GitHub repo, inside a folder called
// "functions" at the repo root, i.e.  functions/_middleware.js
// (next to index.html — Cloudflare deploys it automatically with the site).
//
// WHAT IT DOES: requests arriving through the Shopify App Proxy carry query
// params (shop, timestamp, logged_in_customer_id, signature). This function
// verifies the HMAC signature with your app's shared secret and injects
//   window.__LUCAS_AUTH__ = {proxied, loggedIn, customerId, shop}
// into the HTML <head>. Patternly's account emblem reads that global.
// Direct visits (pages.dev, GitHub) simply get proxied:false.
//
// REQUIRED SETTING: in the Cloudflare Pages project →
// Settings → Variables and secrets (or "Environment variables") → add:
//   Name:  SHOPIFY_APP_SECRET      Type: Secret (encrypted)
//   Value: the app's secret from the Shopify Dev Dashboard — open the
//          Patternly app → Settings / API credentials → "API secret key"
//          (sometimes labelled "Client secret").
// Add it for Production (and Preview if you like), then redeploy once
// (Deployments → ⋯ → Retry, or just push any commit).

const enc = new TextEncoder();

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  const auth = { proxied: false, loggedIn: false, customerId: null, shop: null };

  const sig = url.searchParams.get("signature");
  if (sig && env.SHOPIFY_APP_SECRET) {
    // Shopify App Proxy signature: all params except `signature`, duplicate
    // keys' values joined with commas, sorted by key, concatenated as
    // key=value with NO separator, HMAC-SHA256 (hex) with the shared secret.
    const grouped = {};
    url.searchParams.forEach((v, k) => {
      if (k === "signature") return;
      grouped[k] = k in grouped ? grouped[k] + "," + v : v;
    });
    const msg = Object.keys(grouped).sort().map(k => `${k}=${grouped[k]}`).join("");
    const digest = await hmacHex(env.SHOPIFY_APP_SECRET, msg);
    if (timingSafeEqual(digest, sig)) {
      auth.proxied = true;
      auth.shop = grouped.shop || null;
      const cid = grouped.logged_in_customer_id;
      if (cid) { auth.loggedIn = true; auth.customerId = cid; }
    }
    // Bad signature → treated as a plain visit (proxied:false). No error page:
    // the app still works, just without account awareness.
  }

  const res = await next();
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;

  const inject = `<script>window.__LUCAS_AUTH__=${JSON.stringify(auth)};</script>`;
  return new HTMLRewriter()
    .on("head", { element(el) { el.prepend(inject, { html: true }); } })
    .transform(res);
}
