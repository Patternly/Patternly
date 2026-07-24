// Patternly — Cloudflare Pages Function v22
// v2 + /patterns/* : serves the Luca-S kit catalogue and pattern files from R2.
//
// The files are deliberately NOT on a public R2 URL. Everything goes through
// this function so that adding "did this customer buy this kit?" later is an
// edit here rather than a migration. Until that check exists, the only gate is
// the App Proxy signature (optional — see ENFORCE_PROXY below).

// Bump on every edit. /whoami reports it, so you can see at a glance whether
// the deploy that is actually running is the file you think you pushed.
const MW_VERSION = "v26";

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

// Every pattern request must arrive through the Shopify App Proxy, signed.
// With this off, patternly.pages.dev/patterns/<SKU>/chart.pdf served the file
// to anyone who guessed the URL — no sign-in, no purchase, no code — which
// walks straight around the entitlement system.
//
// Set it back to false only to debug directly against <project>.pages.dev,
// and remember that while it is false the patterns are effectively public.
const ENFORCE_PROXY = true;

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

// ── Entitlement: does this customer own this pattern? ─────────────────────
// The proxy already tells us WHO they are — logged_in_customer_id, signed by
// Shopify, so it cannot be forged. This adds WHAT THEY BOUGHT.
//
// Lookup is by EMAIL, not customer id. A shop using email-code sign-in keys
// everything to the address, and a guest checkout under the same address ends
// up on the same customer record — querying by email catches both, where
// customer_id alone would miss guest orders.
//
// Needs, in addition to the catalogue vars:
//   SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET   from the app's Credentials
// Scopes: read_customers, read_orders — and read_all_orders once Shopify
// approves it, without which only the last 60 days of orders are visible.
//
// Leave the client vars unset and entitlement is simply off: the access code
// remains the only gate, so nothing breaks while approval is pending.

const _cache = new Map();                       // key -> {v, exp}
function cacheGet(k) {
  const hit = _cache.get(k);
  if (hit && hit.exp > Date.now()) return hit.v;
  if (hit) _cache.delete(k);
  return null;
}
function cacheSet(k, v, ttlMs) {
  if (_cache.size > 500) _cache.clear();        // isolate-local, keep it bounded
  _cache.set(k, { v, exp: Date.now() + ttlMs });
}

async function adminToken(env) {
  // A permanent token from a legacy custom app wins outright: no OAuth, no
  // expiry, no organization requirement. The client-credentials path below is
  // kept as a fallback, but it only works when the app and the store are in
  // the same Shopify org — a Partner-org app talking to a production store
  // gets "shop_not_permitted", which is exactly what this store returns.
  if (env.SHOPIFY_ADMIN_TOKEN) return env.SHOPIFY_ADMIN_TOKEN;

  const cached = cacheGet("admin_token");
  if (cached) return cached;
  const store = env.SHOPIFY_STORE;
  const id = env.SHOPIFY_CLIENT_ID, secret = env.SHOPIFY_CLIENT_SECRET;
  if (!store || !id || !secret) return null;
  // JSON first; if the endpoint rejects the shape, retry form-encoded. Which
  // one Shopify wants has moved around, and one retry is cheaper than a
  // debugging round trip.
  let resp = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret
    })
  });
  if (resp.status === 400) {
    resp = await fetch(`https://${store}/admin/oauth/access_token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "accept": "application/json"
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: id,
        client_secret: secret
      }).toString()
    });
  }
  if (!resp.ok) {
    // Shopify names the reason (invalid_client, application_cannot_be_found,
    // …) and the reason is the whole diagnosis here, so pass it through rather
    // than reporting a bare status code.
    let detail = "";
    try { detail = (await resp.text()).slice(0, 300); } catch (e) {}
    throw new Error("admin token " + resp.status + (detail ? " — " + detail : ""));
  }
  const json = await resp.json();
  if (!json.access_token) throw new Error("admin token missing from response");
  // Re-mint well before any expiry rather than tracking it exactly.
  const ttl = Math.min(((json.expires_in || 3600) - 120) * 1000, 45 * 60 * 1000);
  cacheSet("admin_token", json.access_token, Math.max(ttl, 60000));
  return json.access_token;
}

async function adminQuery(env, query, variables) {
  const token = await adminToken(env);
  if (!token) return null;
  const version = env.SHOPIFY_API_VERSION || "2026-07";
  const resp = await fetch(`https://${env.SHOPIFY_STORE}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables })
  });
  if (!resp.ok) throw new Error("admin API " + resp.status);
  const json = await resp.json();
  if (json.errors && json.errors.length) {
    throw new Error("admin API: " + json.errors.map(e => e.message).join("; "));
  }
  return json.data;
}

// Tags are fetched alongside the email because every caller already makes this
// round trip, so the subscription tag costs us nothing extra.
const CUSTOMER_EMAIL_QUERY = `
query CustomerEmail($id: ID!) { customer(id: $id) { email tags } }`;

const ORDER_SKUS_QUERY = `
query OrderSkus($q: String!, $cursor: String) {
  orders(first: 50, query: $q, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt
      cancelledAt
      displayFinancialStatus
      lineItems(first: 100) {
        nodes { sku quantity refundableQuantity }
      }
    }
  }
}`;

// A line is void if its order was cancelled or fully refunded, or if every unit
// of that line has been refunded individually.
function lineIsVoid(order, li) {
  if (order.cancelledAt) return true;
  const fin = order.displayFinancialStatus;
  if (fin === "REFUNDED" || fin === "VOIDED") return true;
  if (fin === "PARTIALLY_REFUNDED") {
    const q = li.quantity | 0, r = li.refundableQuantity | 0;
    if (q > 0 && r === 0) return true;      // nothing left unrefunded on this line
  }
  return false;
}

// ── Permanent entitlement record ──────────────────────────────────────────
// read_orders only sees the last 60 days, so a purchase would silently expire:
// buy a kit in January, start stitching in April, and the pattern you own asks
// for a code. A 43,000-stitch project outlives that window by months, and so
// does changing phone.
//
// So entitlements LATCH. Every time the lookup runs it merges what it found
// into a permanent record, and the record is checked alongside the API. One
// visit while an order is still visible fixes that purchase forever — and
// because the whole SKU set is latched, not just the pattern being opened,
// loading Patternly once covers every kit on the account.
//
// Needs a KV namespace bound as ENTITLEMENTS. Without it everything still
// works, just without the permanence.
async function latchedSkus(customerId, env) {
  if (!env.ENTITLEMENTS) return null;
  try {
    const raw = await env.ENTITLEMENTS.get("cust:" + customerId);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) {
    console.warn("latched read failed:", e.message);
    return null;
  }
}
// Remove entitlements that the store now says were never really bought.
async function unlatchSkus(customerId, skus, env) {
  if (!env.ENTITLEMENTS || !skus || !skus.size) return;
  try {
    const have = await latchedSkus(customerId, env);
    if (!have || !have.size) return;
    let changed = false;
    for (const s of skus) if (have.delete(s)) changed = true;
    if (changed) {
      await env.ENTITLEMENTS.put("cust:" + customerId, JSON.stringify([...have].sort()));
      console.log("revoked for " + customerId + ": " + [...skus].join(", "));
    }
  } catch (e) {
    console.warn("unlatch failed:", e.message);
  }
}
async function latchSkus(customerId, skus, env) {
  if (!env.ENTITLEMENTS || !skus || !skus.size) return;
  try {
    const have = (await latchedSkus(customerId, env)) || new Set();
    let added = false;
    for (const s of skus) if (!have.has(s)) { have.add(s); added = true; }
    if (added) {
      await env.ENTITLEMENTS.put("cust:" + customerId, JSON.stringify([...have].sort()));
    }
  } catch (e) {
    console.warn("latch write failed:", e.message);
  }
}

// Every SKU this customer has bought, upper-cased. The union of what the API
// can still see and what we have already recorded permanently.
async function ownedSkus(customerId, env) {
  const ck = "owned:" + customerId;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const latched = await latchedSkus(customerId, env);

  let who = null;
  try {
    who = await adminQuery(env, CUSTOMER_EMAIL_QUERY, {
      id: "gid://shopify/Customer/" + customerId
    });
  } catch (e) {
    // Shopify unreachable: the permanent record still stands on its own.
    console.warn("customer lookup failed, using latched only:", e.message);
    if (latched) { cacheSet(ck, latched, 5 * 60 * 1000); return latched; }
    throw e;
  }
  if (!who) return latched;                     // not configured
  const email = who.customer && who.customer.email;
  if (!email) return latched || new Set();

  const skus = new Set();     // kits genuinely paid for
  const voided = new Set();   // kits from cancelled or refunded lines
  let cursor = null;
  for (let page = 0; page < 10; page++) {       // up to 500 orders
    const data = await adminQuery(env, ORDER_SKUS_QUERY, {
      q: `email:${JSON.stringify(email)}`, cursor
    });
    const orders = data && data.orders;
    if (!orders) break;
    for (const o of orders.nodes) {
      for (const li of o.lineItems.nodes) {
        if (!li.sku) continue;
        const sku = String(li.sku).trim().toUpperCase();
        // The Plus subscription is NOT a kit and must never be latched. Kits
        // latch because ownership is permanent; a membership is the opposite —
        // it has to be able to lapse. Latching it would make one payment grant
        // the Tracker forever and make cancellation unenforceable. Plus is
        // judged fresh, on a rolling window, in plusFromOrders().
        if (isPlusSku(sku, env)) continue;
        if (lineIsVoid(o, li)) voided.add(sku);
        else skus.add(sku);
      }
    }
    if (!orders.pageInfo.hasNextPage) break;
    cursor = orders.pageInfo.endCursor;
  }
  // Cancelled or refunded revokes — including a kit latched earlier, so opening
  // a pattern and then refunding does not keep it forever. Buying the same kit
  // twice and cancelling one order is not a revocation: a live line for that
  // SKU always wins over a void one.
  const revoke = new Set([...voided].filter(sk => !skus.has(sk)));
  if (revoke.size) await unlatchSkus(customerId, revoke, env);

  await latchSkus(customerId, skus, env);
  if (latched) for (const s of latched) if (!revoke.has(s)) skus.add(s);
  cacheSet(ck, skus, 60 * 1000);                // 1 min: a fresh purchase should appear almost at once
  return skus;
}

// ── Plus subscription ─────────────────────────────────────────────────────
// Whether this customer may use the Stitch Tracker. Three ways in:
//   • an active Shopify subscription contract
//   • an unexpired free trial, started from the pricing page
//   • an override list, so testing does not require a live subscription
//
// Membership is read from ORDERS, not from subscription contracts.
//
// The obvious route — customer.subscriptionContracts — is closed to us, and it
// is worth writing down why so nobody spends another afternoon on it:
//
//   • The scope that opens that field is read_own_subscription_contracts, and
//     "own" is literal: it covers contracts the querying app created. Ours are
//     created by the Shopify Subscriptions app, so even with the scope granted
//     the list would come back empty — a silent failure, worse than a loud one.
//     Reading another app's contracts needs all_subscription_contracts, which
//     is Shopify-approval gated.
//   • Every Admin call here runs on the legacy custom app token, and that app
//     offers no subscription scope at all: searching "subscription" in its
//     Admin API scope list returns nothing.
//
// So we use the side effect instead of the cause. Every renewal bills an order
// containing the Plus SKU, and read_orders — which we already have, and which
// already powers kit ownership — can see it. A live line inside a rolling
// window means the membership is being paid for.
//
// This also happens to be app-agnostic in the way the contract query was meant
// to be: swap Shopify Subscriptions for Recharge or Appstle and the orders
// still appear, so nothing here changes.
// Two plans, two windows. An annual subscriber pays once and then produces no
// order for twelve months, so judging them on the monthly window would revoke
// access at day 35 from someone who has paid for a year. Each plan therefore
// carries its own grace period, keyed on the SKU that appears on the order.
const PLUS_WINDOW_DAYS = 35;        // monthly: 30-day cycle + card-retry grace
const PLUS_YEAR_WINDOW_DAYS = 400;  // annual: 365 + the same kind of grace
const TRIAL_DAYS = 14;
const FREE_EXPORTS_PER_MONTH = 5;

// SKU (upper-cased) → window in days. Both are overridable so the SKUs can be
// renamed in Shopify without a deploy.
function plusPlans(env) {
  const plans = new Map();
  plans.set(String(env.PLUS_SKU || "PatternlyPlus").trim().toUpperCase(),
            Number(env.PLUS_WINDOW_DAYS) || PLUS_WINDOW_DAYS);
  plans.set(String(env.PLUS_SKU_YEAR || "PatternlyPlusYear").trim().toUpperCase(),
            Number(env.PLUS_YEAR_WINDOW_DAYS) || PLUS_YEAR_WINDOW_DAYS);
  return plans;
}

// Is this SKU one of the membership plans? Used to keep the membership out of
// the permanent kit latch.
function isPlusSku(sku, env) {
  return plusPlans(env).has(String(sku).trim().toUpperCase());
}

// Does this customer carry the "active subscriber" tag?
//
// This is the path that makes free trials work. During a trial no money moves,
// so Shopify creates no order and plusFromOrders() sees nothing — but the
// subscription app tags the customer the moment they sign up, and that tag is
// readable with read_customers, which we already have. When the trial converts,
// orders start appearing too and either signal alone would do.
//
// Tags are compared case-insensitively; Shopify preserves the case you type but
// is not consistent about it across surfaces.
function hasPlusTag(tags, env) {
  const want = String(env.PLUS_TAG || "patternly-plus").trim().toLowerCase();
  if (!want || !Array.isArray(tags)) return false;
  return tags.some(t => String(t).trim().toLowerCase() === want);
}
// Only orders inside the window are asked for, so this is a cheap query even
// for a customer with a long history.
async function plusFromOrders(email, env) {
  const out = { paidAt: 0, until: 0, plan: null };
  const plans = plusPlans(env);
  if (!email) return out;

  // The lookback must cover the longest plan, or an annual subscriber ten
  // months in would not be found at all.
  const lookback = Math.max(...plans.values());

  // Matched by email, like kit ownership, so a subscription taken out as a
  // guest under the same address still counts.
  const since = new Date(Date.now() - lookback * 86400000)
                  .toISOString().slice(0, 10);
  const q = `email:${JSON.stringify(email)} AND created_at:>=${since}`;

  let cursor = null;
  for (let page = 0; page < 8; page++) {
    const data = await adminQuery(env, ORDER_SKUS_QUERY, { q, cursor });
    const orders = data && data.orders;
    if (!orders) break;
    for (const o of orders.nodes) {
      for (const li of o.lineItems.nodes) {
        if (!li.sku) continue;
        const sku = String(li.sku).trim().toUpperCase();
        const windowDays = plans.get(sku);
        if (windowDays === undefined) continue;
        if (lineIsVoid(o, li)) continue;        // cancelled or refunded: does not count
        const t = Date.parse(o.createdAt) || 0;
        if (!t) continue;
        // Furthest expiry wins, not newest order: someone who buys an annual
        // plan and later has a stray monthly order should keep the annual.
        const until = t + windowDays * 86400000;
        if (until > out.until) {
          out.until = until;
          out.paidAt = t;
          out.plan = windowDays >= PLUS_YEAR_WINDOW_DAYS ? "annual" : "monthly";
        }
      }
    }
    if (!orders.pageInfo.hasNextPage) break;
    cursor = orders.pageInfo.endCursor;
  }

  return out;
}

async function plusState(auth, env) {
  const out = { plus: false, source: null, trialEndsAt: null, trialUsed: false };
  if (!auth.loggedIn || !auth.customerId) return out;

  // Manual override, for testing and for comping individual customers.
  const allow = (env.PLUS_CUSTOMERS || "").split(",").map(x => x.trim()).filter(Boolean);
  if (allow.includes(String(auth.customerId))) {
    out.plus = true; out.source = "override";
    return out;
  }

  // Trial record, held alongside entitlements.
  if (env.ENTITLEMENTS) {
    try {
      const raw = await env.ENTITLEMENTS.get("trial:" + auth.customerId);
      if (raw) {
        const t = JSON.parse(raw);
        out.trialUsed = true;
        out.trialEndsAt = t.endsAt || 0;
        if (t.endsAt && t.endsAt > Date.now()) { out.plus = true; out.source = "trial"; }
      }
    } catch (e) { console.warn("trial read failed:", e.message); }
  }

  // One customer fetch serves both checks below.
  try {
    const who = await adminQuery(env, CUSTOMER_EMAIL_QUERY, {
      id: "gid://shopify/Customer/" + auth.customerId
    });
    const cust = (who && who.customer) || {};

    // 1. Subscription tag. Covers trials, where no order exists yet.
    if (hasPlusTag(cust.tags, env)) {
      out.plus = true;
      out.source = "subscription";
      out.via = "tag";
    }

    // 2. Orders. A backstop: if the app ever fails to tag someone, a real
    //    payment still grants access. Also supplies the lapse date, which a
    //    tag cannot — a tag says "is a subscriber", not "until when".
    const sub = await plusFromOrders(cust.email, env);
    if (sub.until > Date.now()) {
      out.plus = true;
      out.source = "subscription";
      out.via = out.via ? "tag+order" : "order";
      out.plan = sub.plan;                   // "monthly" or "annual"
      out.plusUntil = sub.until;             // ~when access lapses without a renewal
      out.paidAt = sub.paidAt;               // last payment seen
    }
  } catch (e) {
    // Shopify unreachable or the query rejected: fall back on trial/override
    // rather than locking a paying customer out of their own project.
    console.warn("subscription lookup failed:", e.message);
    out.subsError = e.message;
  }
  return out;
}

// null  → entitlement not configured, fall through to the access code
// true  → owns it
// false → signed in, does not own it
// "anon"→ nobody is signed in, so ownership cannot be judged
async function customerOwns(auth, sku, env) {
  if (!env.SHOPIFY_ADMIN_TOKEN && !(env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET)) return null;
  if (!auth.loggedIn || !auth.customerId) return "anon";
  const owned = await ownedSkus(auth.customerId, env);
  if (!owned) return null;
  return owned.has(String(sku).trim().toUpperCase());
}

// Streams an object out of R2 with the right headers.
async function deliver(key, env) {
  const obj = await env.PATTERNS.get(key);
  if (!obj) return new Response("not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  if (!headers.has("content-type")) {
    const ext = key.split(".").pop().toLowerCase();
    headers.set("content-type", MIME[ext] || "application/octet-stream");
  }
  return new Response(obj.body, { headers });
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

  // ── Entitlement ───────────────────────────────────────────────────────
  // Owning the kit is the primary key. The access code stays as a fallback so
  // that a buyer the lookup misses — an old order while read_all_orders is
  // still pending, a different email at checkout — is not locked out of a
  // pattern they paid for.
  if (needsCode(key)) {
    const sku = key.split("/")[0];
    let owns = null;
    try {
      owns = await customerOwns(auth, sku, env);
    } catch (e) {
      // A Shopify outage must not lock buyers out; fall through to the code.
      console.warn("entitlement lookup failed for " + sku + ":", e.message);
    }
    if (owns === true) {
      return deliver(key, env);                 // bought it — no code needed
    }
    // Ownership is the FIRST question, always. An access-code check placed
    // ahead of this returns 401 to a genuine buyer before anyone asks whether
    // they bought the kit — which is exactly what it did until v12.
    if (owns === null) {
      // Entitlement not configured, or the lookup failed: the code is the gate.
      const c = checkAccessCode(request, url, env, key);
      if (!c.ok) {
        return new Response("access code required", {
          status: 401,
          headers: { "x-code-seen": c.seen ? "1" : "0", "cache-control": "no-store" }
        });
      }
      return deliver(key, env);
    }
    if (owns === false || owns === "anon") {
      // Not a buyer (or not signed in): the access code is the remaining route.
      const c = checkAccessCode(request, url, env, key);
      if (!c.ok) {
        return new Response(
          JSON.stringify({
            error: owns === "anon" ? "signin" : "notpurchased",
            sku,
            message: owns === "anon"
              ? "Sign in to your Luca-S account to open the patterns you've bought."
              : "This pattern comes with the kit. Buy it, or enter an access code."
          }),
          {
            status: owns === "anon" ? 401 : 403,
            headers: {
              "content-type": "application/json",
              "x-code-seen": c.seen ? "1" : "0",
              "cache-control": "no-store"
            }
          }
        );
      }
      return deliver(key, env);
    }
  }

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
      entitlement: !!(env.SHOPIFY_ADMIN_TOKEN || (env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET)),
      adminTokenDirect: !!env.SHOPIFY_ADMIN_TOKEN,
      entitlementsPersist: !!env.ENTITLEMENTS,
      catalogueLive: !!(env.SHOPIFY_STORE && env.SHOPIFY_STOREFRONT_TOKEN),
      enforceProxy: ENFORCE_PROXY
    };

    // A signed-in customer gets their own email and the SKUs they own, so the
    // account page can show "your patterns" without a second round trip. This
    // is the customer's own data and nobody else's — the id comes from
    // Shopify's signature, so it cannot be asked for on another's behalf.
    if (auth.loggedIn && auth.customerId) {
      try {
        const who = await adminQuery(env, CUSTOMER_EMAIL_QUERY, {
          id: "gid://shopify/Customer/" + auth.customerId
        });
        if (who && who.customer && who.customer.email) body.email = who.customer.email;
        Object.assign(body, await plusState(auth, env));
        const owned = await ownedSkus(auth.customerId, env);
        if (owned) body.ownedSkus = [...owned].sort();
      } catch (e) {
        // Never fail /whoami over this — sign-in state still matters.
        console.warn("whoami entitlement summary failed:", e.message);
      }
    }

    // ?debug=1 runs the entitlement lookup live and reports where it stops.
    // A customer only ever sees their OWN purchases here, and every step is
    // named, so a failure points at one layer instead of "it doesn't work".
    if (url.searchParams.get("debug") === "1") {
      const d = { step: "start" };
      try {
        if (!env.SHOPIFY_ADMIN_TOKEN && !(env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET)) {
          d.step = "not-configured";
          d.hint = "Set SHOPIFY_ADMIN_TOKEN (from a legacy custom app), or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET";
        } else if (!auth.proxied) {
          d.step = "not-proxied";
          d.hint = "Open this through luca-s.com/apps/patternly/whoami?debug=1 — a bare pages.dev request carries no Shopify signature";
        } else if (!auth.loggedIn) {
          d.step = "not-signed-in";
          d.hint = "Signature verified, but Shopify sent no logged_in_customer_id — sign in on luca-s.com first";
        } else {
          d.customerId = auth.customerId;
          d.step = "minting-admin-token";
          const tok = await adminToken(env);
          d.tokenOk = !!tok;
          d.step = "reading-customer";
          const who = await adminQuery(env, CUSTOMER_EMAIL_QUERY, {
            id: "gid://shopify/Customer/" + auth.customerId
          });
          const email = who && who.customer && who.customer.email;
          d.emailFound = !!email;
          if (email) d.emailMasked = email.replace(/^(.).*(@.*)$/, "$1***$2");
          d.step = "reading-orders";
          const owned = await ownedSkus(auth.customerId, env);
          d.skus = owned ? [...owned].sort() : null;
          d.skuCount = owned ? owned.size : 0;
          d.step = "done";
          if (!d.skuCount) {
            d.hint = "No SKUs found. Either the order is older than 60 days (needs read_all_orders), the checkout used a different email, or the line items carry no SKU.";
          }
        }
      } catch (e) {
        d.error = e.message;
        d.hint = "Lookup threw at step '" + d.step + "'. A 403 here usually means the app install has not been updated with read_customers / read_orders.";
      }
      body.entitlementCheck = d;
    }
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }

  // ── /plus: start the free trial ──────────────────────────────────────────
  // One trial per customer, recorded server-side so clearing the browser or
  // switching device cannot restart it.
  if (url.pathname === "/plus/trial" || url.pathname.endsWith("/plus/trial")) {
    if (!auth.loggedIn || !auth.customerId) {
      return new Response(JSON.stringify({ error: "signin" }), {
        status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    }
    if (!env.ENTITLEMENTS) {
      return new Response(JSON.stringify({ error: "storage" }), {
        status: 500, headers: { "content-type": "application/json" }
      });
    }
    const key = "trial:" + auth.customerId;
    const existing = await env.ENTITLEMENTS.get(key);
    if (existing) {
      return new Response(existing, {
        status: 409, headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    }
    const rec = { startedAt: Date.now(), endsAt: Date.now() + TRIAL_DAYS * 86400000 };
    await env.ENTITLEMENTS.put(key, JSON.stringify(rec));
    return new Response(JSON.stringify(rec), {
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }

  // ── /exports: monthly export quota for the free tier ─────────────────────
  //
  // Free accounts get FREE_EXPORTS_PER_MONTH files; Plus is unlimited. The
  // count lives server-side so it survives a cleared browser — but only for
  // signed-in customers. Anonymous visitors are counted in the app's own
  // storage, which is trivially reset; that is accepted. The limit is a nudge
  // towards an account, not a lock, and the honest place to make it real is at
  // sign-in rather than in an arms race with incognito windows.
  //
  // Saving a pattern does not count. Only a file actually leaving the app does.
  //
  // GET  /exports  -> {used, limit, plus, resetsAt}
  // POST /exports  -> same, after incrementing; 402 when the month is spent
  if (url.pathname === "/exports" || url.pathname.endsWith("/exports")) {
    if (!auth.loggedIn || !auth.customerId) {
      return new Response(JSON.stringify({ error: "signin" }), {
        status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    }
    if (!env.ENTITLEMENTS) {
      return new Response(JSON.stringify({ error: "storage" }), {
        status: 500, headers: { "content-type": "application/json" }
      });
    }

    const limit = Number(env.FREE_EXPORTS_PER_MONTH) || FREE_EXPORTS_PER_MONTH;
    const plus  = (await plusState(auth, env)).plus;

    // Month boundaries in UTC. A stitcher in Auckland rolls over a few hours
    // early and one in Los Angeles a few late; that is not worth a timezone
    // round trip, and erring early is the friendlier direction.
    const now = new Date();
    const month = now.toISOString().slice(0, 7);            // YYYY-MM
    const resetsAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const key = "exports:" + auth.customerId + ":" + month;

    const read = async () => Number(await env.ENTITLEMENTS.get(key)) || 0;
    const body = (used) => JSON.stringify({
      used, limit, plus, resetsAt,
      remaining: plus ? null : Math.max(0, limit - used)
    });
    const json = (used, status) => new Response(body(used), {
      status: status || 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });

    if (request.method === "GET") return json(await read());

    if (request.method === "POST") {
      const used = await read();
      // Plus is not counted at all — no write, so cancelling later starts the
      // free allowance clean rather than mid-month with a phantom tally.
      if (plus) return json(used);
      if (used >= limit) return json(used, 402);
      // Last-write-wins: two exports fired in the same instant could count as
      // one. KV has no atomic increment, and under-counting by one occasionally
      // is a far better failure than blocking someone's work.
      await env.ENTITLEMENTS.put(key, String(used + 1), {
        expirationTtl: 70 * 86400            // tidies itself well after the month
      });
      return json(used + 1);
    }

    return new Response("method not allowed", { status: 405 });
  }

  // ── /progress: stitch progress that follows the account ──────────────────
  // Only for catalogue kits: the chart itself re-downloads from R2 by SKU, so
  // the sync carries progress alone — one bit per cell, a few KB even for a
  // 43,000-stitch kit. Uploaded patterns stay local; their chart is the user's
  // own file and there is nothing to re-fetch it from.
  //
  // GET  /progress?sku=B724   -> {data, done, ts}
  // PUT  /progress?sku=B724   <- {data, done}
  if (url.pathname === "/progress" || url.pathname.endsWith("/progress")) {
    const bad = (msg, code) => new Response(JSON.stringify({ error: msg }), {
      status: code, headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
    if (!auth.loggedIn || !auth.customerId) return bad("signin", 401);
    if (!env.ENTITLEMENTS) return bad("storage not configured", 500);
    const sku = (url.searchParams.get("sku") || "").trim().toUpperCase();

    // No sku: list every kit this account has progress for, so the tracked
    // list can be rebuilt on a device that has never opened them. Returns
    // summaries only — the stitch data itself is fetched per kit.
    if (!sku && request.method === "GET") {
      const out = [];
      let cursor;
      for (let page = 0; page < 5; page++) {
        const listed = await env.ENTITLEMENTS.list({
          prefix: "prog:" + auth.customerId + ":", limit: 1000, cursor
        });
        for (const k of listed.keys) {
          const raw = await env.ENTITLEMENTS.get(k.name);
          if (!raw) continue;
          try {
            const rec = JSON.parse(raw);
            out.push({
              sku: k.name.split(":").pop(),
              done: rec.done | 0, cols: rec.cols | 0, rows: rec.rows | 0,
              total: rec.total | 0, threads: rec.threads | 0,
              timeMs: rec.timeMs | 0, sessions: rec.sessions | 0,
              ts: rec.ts || 0
            });
          } catch (e) {}
        }
        if (!listed.list_complete) cursor = listed.cursor; else break;
      }
      out.sort((a, b) => b.ts - a.ts);
      return new Response(JSON.stringify({ kits: out }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    }
    if (!sku || !/^[A-Z0-9_-]{1,40}$/.test(sku)) return bad("bad sku", 400);

    // You can only sync progress for a kit you own — otherwise this is free
    // storage for anyone with an account.
    try {
      const owns = await customerOwns(auth, sku, env);
      if (owns === false) return bad("notpurchased", 403);
    } catch (e) {
      console.warn("progress entitlement check failed:", e.message);
    }

    const key = "prog:" + auth.customerId + ":" + sku;
    if (request.method === "GET") {
      const raw = await env.ENTITLEMENTS.get(key);
      return new Response(raw || JSON.stringify({ data: null }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    }
    if (request.method === "PUT" || request.method === "POST") {
      let body;
      try { body = await request.json(); } catch (e) { return bad("bad body", 400); }
      if (typeof body.data !== "string" || body.data.length > 400000) return bad("bad data", 400);
      const rec = {
        data: body.data,
        cols: body.cols | 0,
        rows: body.rows | 0,
        done: body.done | 0,
        // Carried so a device that has never opened the kit can still draw a
        // full project card rather than a stub.
        total: body.total | 0,
        threads: body.threads | 0,
        timeMs: body.timeMs | 0,
        sessions: body.sessions | 0,
        ts: Date.now()
      };
      await env.ENTITLEMENTS.put(key, JSON.stringify(rec));
      return new Response(JSON.stringify({ ok: true, ts: rec.ts }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    }
    if (request.method === "DELETE") {
      // Clears the account copy of a kit's progress. Entitlement is untouched —
      // the kit is still owned, it just has no stitching recorded any more.
      await env.ENTITLEMENTS.delete(key);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    }
    return bad("method", 405);
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
