// Patternly — Cloudflare Pages Function v5
// v2 + /patterns/* : serves the Luca-S kit catalogue and pattern files from R2.
//
// The files are deliberately NOT on a public R2 URL. Everything goes through
// this function so that adding "did this customer buy this kit?" later is an
// edit here rather than a migration. Until that check exists, the only gate is
// the App Proxy signature (optional — see ENFORCE_PROXY below).

// Bump on every edit. /whoami reports it, so you can see at a glance whether
// the deploy that is actually running is the file you think you pushed.
const MW_VERSION = "v5";

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

// Temporary shared access code for the kit catalogue, read from the
// PATTERN_ACCESS_CODE environment variable. Leave the variable unset and the
// catalogue is open — so this is opt-in, and dev deploys need no code.
//
// A shared code is weak by nature: anyone who has it can pass it on, and it
// cannot tell one customer from another. It is a curtain while you finish
// testing, not the entitlement check. That arrives with the order lookup.
// The catalogue listing and cover art stay open — browsing the shop window
// costs nothing. The pattern data behind it is what the code protects.
function needsCode(key) {
  if (!key.includes("/")) return false;                 // kits.json at the root
  const leaf = key.split("/").pop().toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif|avif|svg)$/.test(leaf)) return false;
  return true;
}

// Which code opens this key. A per-SKU entry in PATTERN_CODES wins, so a code
// can unlock exactly one pattern; PATTERN_ACCESS_CODE is the fallback that
// opens everything. Set only the fallback and you have one shared code; fill
// in PATTERN_CODES and each kit gets its own without touching this file.
//
//   PATTERN_CODES = {"BU5102":"12345","BU5104":"98765"}
//
// Move this to a KV namespace when issuing a code should not mean a redeploy.
function codeFor(key, env) {
  const sku = key.split("/")[0];
  if (env.PATTERN_CODES) {
    try {
      const map = JSON.parse(env.PATTERN_CODES);
      if (map && map[sku]) return String(map[sku]);
    } catch (e) {
      console.warn("PATTERN_CODES is not valid JSON — ignoring it");
    }
  }
  return env.PATTERN_ACCESS_CODE || null;
}

function checkAccessCode(request, url, env, key) {
  if (!needsCode(key)) return { ok: true, seen: false };
  const want = codeFor(key, env);
  if (!want) return { ok: true, seen: false };
  const got =
    request.headers.get("x-patternly-code") ||
    url.searchParams.get("pcode") ||
    "";
  return { ok: timingSafeEqual(got, want), seen: got.length > 0 };
}

const MIME = {
  json: "application/json",
  pdf: "application/pdf",
  ptly: "application/octet-stream",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp"
};

async function servePattern(key, auth, request, url, env) {
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

  // 401 means "you need a code / that code is wrong" and the app prompts for
  // one. 403 is reserved for "you are known, and you don't own this kit", so
  // the two cases stay distinguishable once entitlement lands.
  const code = checkAccessCode(request, url, env, key);
  if (!code.ok) {
    return new Response("access code required", {
      status: 401,
      headers: { "x-code-seen": code.seen ? "1" : "0", "cache-control": "no-store" }
    });
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
    // Config readout: presence only, never values. This is what tells you
    // whether a missing gate is a stale deploy or a missing variable.
    const body = {
      ...auth,
      mw: MW_VERSION,
      patternsBound: !!env.PATTERNS,
      accessCodeSet: !!env.PATTERN_ACCESS_CODE,
      perKitCodes: !!env.PATTERN_CODES,
      enforceProxy: ENFORCE_PROXY
    };
    return new Response(JSON.stringify(body), {
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
    return servePattern(key, auth, request, url, env);
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
