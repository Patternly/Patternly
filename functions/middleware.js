// ═══════════════════════════════════════════════════════════════════════════
// Patternly middleware v60 — Sign in with Apple (/auth/apple)
// Drop-in for _middleware.js (v59, MW_VERSION on line 11). Two paste blocks +
// one checklist below. After pasting, set MW_VERSION = "v60".
//
// WHY: App Review guideline 4.8 — the Shopify hosted login offers Shop/Google
// (third-party logins), so the iOS app must offer an equivalent private option.
// The iOS app shows a native "Sign in with Apple" sheet, then POSTs Apple's
// identity token here. We verify it against Apple's public keys, find-or-create
// the Shopify customer by the token's email, and mint the SAME pl_session the
// /auth/callback flow mints — everything downstream (kit latching, tracker
// sync, /progress) is untouched and unaware of how the person signed in.
//
// RULE #1 note: this file only ADDS an endpoint. No existing route, the session
// token format, or any of the five pl_session-carrying calls change.
// ═══════════════════════════════════════════════════════════════════════════


// ── BLOCK A ── paste at top level, near the other helper functions ──────────

// Apple's JWKS, cached per-isolate for an hour. Verification needs no secret:
// the identity token is signed by Apple; we check the signature, issuer,
// audience (our bundle id) and expiry.
let _appleJwksCache = { keys: null, at: 0 };
async function appleJwks() {
  if (_appleJwksCache.keys && Date.now() - _appleJwksCache.at < 3600000) return _appleJwksCache.keys;
  const r = await fetchWithTimeout("https://appleid.apple.com/auth/keys", { headers: { accept: "application/json" } }, 8000);
  if (!r.ok) throw new Error("apple-jwks " + r.status);
  const j = await r.json();
  _appleJwksCache = { keys: j.keys || [], at: Date.now() };
  return _appleJwksCache.keys;
}

function _b64uToBytes(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Verify an Apple identity token (RS256 JWT). Returns the payload claims or
// throws with a short reason. `aud` must be the iOS bundle id for native
// Sign in with Apple (com.lucas.patternly).
async function verifyAppleIdentityToken(env, jwt) {
  const parts = String(jwt || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const header = JSON.parse(new TextDecoder().decode(_b64uToBytes(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(_b64uToBytes(parts[1])));

  const keys = await appleJwks();
  const jwk = keys.find(k => k.kid === header.kid && (!header.alg || k.alg === header.alg || k.alg === undefined));
  if (!jwk) throw new Error("no matching Apple key (kid " + header.kid + ")");

  const key = await crypto.subtle.importKey(
    "jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key,
    _b64uToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1])
  );
  if (!ok) throw new Error("bad signature");

  if (payload.iss !== "https://appleid.apple.com") throw new Error("bad issuer");
  const wantAud = env.APPLE_BUNDLE_ID || "com.lucas.patternly";
  if (payload.aud !== wantAud) throw new Error("bad audience " + payload.aud);
  if (!payload.exp || Date.now() / 1000 > payload.exp + 60) throw new Error("token expired");
  return payload;
}

// Find a Shopify customer by email, creating one if absent. Needs the Admin
// token to carry write_customers for the create branch; without it, sign-in
// still works for EXISTING customers and returns a clear error otherwise.
const CUSTOMER_CREATE_MUTATION = `mutation($input:CustomerInput!){ customerCreate(input:$input){ customer{ id email } userErrors{ field message } } }`;
async function findOrCreateCustomerByEmail(env, email, firstName, lastName) {
  const r = await adminQuery(env, CUSTOMER_BY_EMAIL_QUERY, { q: "email:" + email });
  const node = r && r.customers && r.customers.edges && r.customers.edges[0] && r.customers.edges[0].node;
  if (node && node.id) return { id: String(node.id).replace(/^gid:\/\/shopify\/Customer\//, ""), created: false };

  const c = await adminQuery(env, CUSTOMER_CREATE_MUTATION, {
    input: { email, firstName: firstName || undefined, lastName: lastName || undefined }
  });
  const errs = c && c.customerCreate && c.customerCreate.userErrors;
  if (errs && errs.length) throw new Error("customerCreate: " + errs.map(e => e.message).join("; "));
  const made = c && c.customerCreate && c.customerCreate.customer;
  if (!made || !made.id) throw new Error("customerCreate returned no customer (is write_customers granted?)");
  return { id: String(made.id).replace(/^gid:\/\/shopify\/Customer\//, ""), created: true };
}


// ── BLOCK B ── paste inside onRequest, next to the other /auth/ routes ──────
// (e.g. right after the /auth/tokentest block)

  // ── /auth/apple : native Sign in with Apple from the iOS app ──────────────
  // POST, application/x-www-form-urlencoded (a "simple" request — no CORS
  // preflight from the Capacitor origin): identity_token=<jwt>&first_name=&last_name=
  // Replies JSON { ok:true, pl_session } — the app stores it in localStorage
  // exactly as it stores the token from the deep-link flow.
  if (url.pathname.endsWith("/auth/apple")) {
    const cors = { "access-control-allow-origin": "*", "cache-control": "no-store", "content-type": "application/json" };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" } });
    if (request.method !== "POST") return new Response(JSON.stringify({ ok: false, msg: "POST only" }), { status: 405, headers: cors });
    try {
      const body = await request.text();
      const p = new URLSearchParams(body);
      const idTok = p.get("identity_token") || "";
      const claims = await verifyAppleIdentityToken(env, idTok);
      const email = claims.email || null;
      if (!email) {
        // Apple always includes the email on FIRST authorization; on later ones
        // it can be absent. The app should request scopes:[email] every time —
        // if it still lands here, ask the user to remove the app under
        // Settings → Apple ID → Sign-In & Security and try again.
        return new Response(JSON.stringify({ ok: false, msg: "Apple returned no email for this sign-in. In iOS Settings → your name → Sign-In & Security → Sign in with Apple, remove Patternly, then try again." }), { status: 400, headers: cors });
      }
      const cust = await findOrCreateCustomerByEmail(env, email, p.get("first_name") || "", p.get("last_name") || "");
      // Same shape and signer as /auth/callback — downstream code cannot tell
      // the difference. idt stays null: /auth/switch's id_token_hint logout is
      // a Shopify-login concern that does not apply to Apple sessions.
      const sessTok = await signCookie(env.CUSTOMER_SESSION_SECRET, {
        customerId: cust.id, email, idt: null, exp: Date.now() + 30 * 24 * 3600 * 1000
      });
      return new Response(JSON.stringify({ ok: true, pl_session: sessTok, created: cust.created, relay: /@privaterelay\.appleid\.com$/i.test(email) }), { headers: cors });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, msg: String(e && e.message || e) }), { status: 401, headers: cors });
    }
  }


// ── INTEGRATION CHECKLIST ───────────────────────────────────────────────────
// 1. Paste Block A near the other top-level helpers, Block B inside
//    onRequest beside the /auth/ routes. Set MW_VERSION = "v60" (line 11).
//    Deploy via the usual git push.
// 2. Shopify Admin app scopes: ADD write_customers (currently read_customers,
//    read_orders). Without it, new-user creation fails with a clear error but
//    existing customers can still sign in.
// 3. Optional env var: APPLE_BUNDLE_ID (defaults to com.lucas.patternly).
// 4. Apple Developer portal: App ID com.lucas.patternly → enable the
//    "Sign in with Apple" capability, then regenerate/refresh the provisioning
//    profile Codemagic uses.
// 5. Smoke test BEFORE app work, straight from a terminal (expects 401 with
//    "malformed token" — proves routing + CORS are live):
//      curl -s -X POST "https://luca-s.com/apps/patternly/auth/apple" \
//           -H "content-type: application/x-www-form-urlencoded" \
//           -d "identity_token=nonsense"
// 6. The app-side piece (next step): Capacitor plugin
//    @capacitor-community/apple-sign-in, an iOS-only "Sign in with Apple"
//    button on the sign-in screen requesting scopes [email, fullName], POST
//    the credential's identityToken + name here, store pl_session from the
//    JSON exactly as the appUrlOpen deep-link handler does. New native build
//    required (plugin adds native code): versionCode 4 / iOS build 3.
// ═══════════════════════════════════════════════════════════════════════════
