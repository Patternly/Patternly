// Patternly — Cloudflare Pages Function v7
// v2 + /patterns/* : serves the Luca-S kit catalogue and pattern files from R2.
//
// The files are deliberately NOT on a public R2 URL. Everything goes through
// this function so that adding "did this customer buy this kit?" later is an
// edit here rather than a migration. Until that check exists, the only gate is
// the App Proxy signature (optional — see ENFORCE_PROXY below).

// Bump on every edit. /whoami reports it, so you can see at a glance whether
// the deploy that is actually running is the file you think you pushed.
const MW_VERSION = "v7";

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

// ── Live catalogue from Shopify ───────────────────────────────────────────
// kits.json is now BUILT from the store, not stored. Products in the
// Needlecraft Kits collection that carry the patternly.pattern metafield are
// the catalogue; the metafield value is the SKU, which is also the R2 folder
// name. Releasing a pattern becomes: upload the folder, set the metafield.
//
// Needs two env vars:
//   SHOPIFY_STORE            luca-s-quality-for-everyone.myshopify.com
//   SHOPIFY_STOREFRONT_TOKEN the Headless public access token
// Optional:
//   KITS_COLLECTION_HANDLE   defaults to "needlecraft-kits"
//   SHOPIFY_API_VERSION      defaults to "2026-07"
//
// Falls back to a stored kits.json in R2 if the store can't be reached, so a
// Shopify hiccup degrades to the last manual manifest rather than an empty
// catalogue.
const KITS_QUERY = `
query Kits($handle: String!, $cursor: String) {
  collection(handle: $handle) {
    products(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        title
        featuredImage { url }
        pattern: metafield(namespace: "patternly", key: "pattern") { value }
      }
    }
  }
}`;

async function buildCatalogue(env) {
  const store = env.SHOPIFY_STORE;
  const token = env.SHOPIFY_STOREFRONT_TOKEN;
  if (!store || !token) return null;                 // not configured — use R2
  const handle = env.KITS_COLLECTION_HANDLE || "needlecraft-kits";
  const version = env.SHOPIFY_API_VERSION || "2026-07";
  const endpoint = `https://${store}/api/${version}/graphql.json`;

  const kits = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {            // hard stop at 2000 products
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Shopify-Storefront-Access-Token": token
      },
      body: JSON.stringify({ query: KITS_QUERY, variables: { handle, cursor } })
    });
    if (!resp.ok) throw new Error("storefront API " + resp.status);
    const json = await resp.json();
    const coll = json.data && json.data.collection;
    if (!coll) return kits;                          // no such collection
    for (const p of coll.products.nodes) {
      const sku = p.pattern && p.pattern.value && p.pattern.value.trim();
      if (!sku) continue;                            // no metafield → not a kit
      const kit = { sku };
      if (p.title) kit.title = p.title;
      if (p.featuredImage && p.featuredImage.url) kit.image = p.featuredImage.url;
      kits.push(kit);
    }
    if (!coll.products.pageInfo.hasNextPage) break;
    cursor = coll.products.pageInfo.endCursor;
  }
  return kits;
}

// Which SKUs actually have pattern files in the bucket. The metafield says a
// product is MEANT to be a kit; this says the files are really there. Listing a
// kit without them gives the customer a card that 404s when clicked, so the
// catalogue is the intersection of the two. That also means you can tag every
// product in the collection up front and each one appears by itself as its
// folder is uploaded.
async function readySkus(env) {
  if (!env.PATTERNS) return null;
  const ready = new Set();
  let cursor;
  for (let page = 0; page < 10; page++) {          // up to 10k objects
    const listed = await env.PATTERNS.list({ limit: 1000, cursor });
    for (const obj of listed.objects) {
      const slash = obj.key.indexOf("/");
      if (slash <= 0) continue;                    // root files aren't kits
      const leaf = obj.key.slice(slash + 1).toLowerCase();
      // A kit is openable when it has a chart — either a .Ptly or a chart PDF.
      if (leaf === "chart.pdf" || leaf === "pattern.ptly") {
        ready.add(obj.key.slice(0, slash));
      }
    }
    if (!listed.truncated) break;
    cursor = listed.cursor;
  }
  return ready;
}

async function serveCatalogue(auth, request, url, env) {
  // The catalogue listing is open; only the pattern files are gated.
  let kits = null;
  try {
    kits = await buildCatalogue(env);
  } catch (e) {
    console.warn("catalogue build failed, falling back to stored kits.json:", e.message);
  }
  if (kits) {
    let listed = kits;
    try {
      const ready = await readySkus(env);
      if (ready) {
        const hidden = kits.filter(k => !ready.has(k.sku)).map(k => k.sku);
        if (hidden.length) {
          console.log("catalogue: tagged but no files yet — " + hidden.join(", "));
        }
        listed = kits.filter(k => ready.has(k.sku));
      }
    } catch (e) {
      // If the bucket can't be listed, show everything rather than nothing —
      // a card that fails on click beats an empty shop.
      console.warn("readySkus failed, listing all tagged kits:", e.message);
    }
    return new Response(JSON.stringify({ kits: listed }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }
  // Fallback: whatever kits.json is still in the bucket.
  if (env.PATTERNS) {
    const obj = await env.PATTERNS.get("kits.json");
    if (obj) {
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("content-type", "application/json");
      headers.set("cache-control", "no-store");
      return new Response(obj.body, { headers });
    }
  }
  return new Response(JSON.stringify({ kits: [] }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

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
      catalogueLive: !!(env.SHOPIFY_STORE && env.SHOPIFY_STOREFRONT_TOKEN),
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
    if (key === "kits.json") return serveCatalogue(auth, request, url, env);
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
