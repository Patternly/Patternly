// Patternly — Cloudflare Pages Function v3
// v2 + /patterns/* : serves the Luca-S kit catalogue and pattern files from R2.
//
// The files are deliberately NOT on a public R2 URL. Everything goes through
// this function so that adding "did this customer buy this kit?" later is an
// edit here rather than a migration. Until that check exists, the only gate is
// the App Proxy signature (optional — see ENFORCE_PROXY below).

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

async function readAuth(url, env) {
  const auth = { proxied: false, loggedIn: false, customerId: null, shop: null };
  const sig = url.searchParams.get("signature");
  if (!sig || !env.SHOPIFY_APP_SECRET) return auth;

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
    if (grouped.logged_in_customer_id) {
      auth.loggedIn = true;
      auth.customerId = grouped.logged_in_customer_id;
    }
  }
  return auth;
}

// Set to true once you're happy that every real request arrives signed.
// Leave false while testing straight against <project>.pages.dev.
const ENFORCE_PROXY = false;

const MIME = {
  json: "application/json",
  pdf: "application/pdf",
  ptly: "application/octet-stream",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp"
};

async function servePattern(key, auth, env) {
  if (!env.PATTERNS) {
    return new Response("pattern storage not bound", { status: 500 });
  }
  // No traversal, no absolute keys.
  if (!key || key.includes("..") || key.startsWith("/")) {
    return new Response("not found", { status: 404 });
  }

  if (ENFORCE_PROXY && !auth.proxied) {
    return new Response("forbidden", { status: 403 });
  }

  // ── Entitlement hook ──────────────────────────────────────────────────
  // When you're ready to restrict kits to buyers, resolve the SKU from the
  // key and check it against this customer's orders. Returning 403 here is
  // all the app needs — it already shows "only available to customers who
  // bought it" for that status.
  //
  //   const sku = key.split("/")[0];
  //   if (!(await customerOwns(auth.customerId, sku, env))) {
  //     return new Response("forbidden", { status: 403 });
  //   }

  const obj = await env.PATTERNS.get(key);
  if (!obj) return new Response("not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  // The manifest changes whenever you add a kit; the pattern files never do.
  headers.set(
    "cache-control",
    key.endsWith("kits.json") ? "no-store" : "private, max-age=3600"
  );
  if (!headers.has("content-type")) {
    const ext = key.split(".").pop().toLowerCase();
    headers.set("content-type", MIME[ext] || "application/octet-stream");
  }
  return new Response(obj.body, { headers });
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const auth = await readAuth(url, env);

  // ── /whoami: live auth check for the running app ──
  if (url.pathname === "/whoami" || url.pathname.endsWith("/whoami")) {
    return new Response(JSON.stringify(auth), {
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }

  // ── /patterns/*: kit catalogue + files from R2 ──
  // Matched by index rather than prefix so it works both on the bare Pages
  // domain and under the Shopify App Proxy path, same as /whoami above.
  const MARK = "/patterns/";
  const at = url.pathname.indexOf(MARK);
  if (at !== -1) {
    const key = decodeURIComponent(url.pathname.slice(at + MARK.length));
    return servePattern(key, auth, env);
  }

  // ── everything else: serve the site, injecting auth into the HTML ──
  const res = await next();
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;

  // NOTE: we deliberately do NOT inject PATTERNLY_KITS_BASE. Under the Shopify
  // App Proxy this function is handed "/" while the browser sits at
  // /apps/patternly, so any base computed here is wrong by the length of the
  // proxy prefix. The app works it out from its own location instead. Set the
  // variable here only to point at a different origin on purpose.
  const inject = `<script>window.__LUCAS_AUTH__=${JSON.stringify(auth)};</script>`;

  return new HTMLRewriter()
    .on("head", { element(el) { el.prepend(inject, { html: true }); } })
    .transform(res);
}
