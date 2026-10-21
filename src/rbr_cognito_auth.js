/* RBR Report Lab: Cognito OAuth authorization code + PKCE (no new npm dependencies).
 * Pilot only. The backend still verifies every ID token with API Gateway,
 * and Lambda independently enforces RBRReportsManagers membership.
 */
const CLIENT_ID = String(import.meta.env.VITE_RBR_COGNITO_CLIENT_ID || "").trim();
const USER_POOL_ID = "ap-south-1_ixh4UjL1x";
const REGION = "ap-south-1";
const MANAGER_GROUP = "RBRReportsManagers";
const REGISTERED_CALLBACK = "https://main.d2fov5sbg0put2.amplifyapp.com/";
const SESSION_KEY = "rbr_employee_cognito_pkce_session_v1";
const PENDING_KEY = "rbr_employee_cognito_pkce_pending_v1";
const RETURN_TAB_KEY = "rbr_employee_cognito_return_tab_v1";
const rawDomain = String(import.meta.env.VITE_RBR_COGNITO_DOMAIN || "").trim();
let refreshInFlight = null;
let initInFlight = null;

function cognitoDomain() {
  if (!rawDomain) return "";
  if (/^[a-z0-9-]+$/i.test(rawDomain)) return `https://${rawDomain}.auth.${REGION}.amazoncognito.com`;
  const value = /^https:\/\//i.test(rawDomain) ? rawDomain : `https://${rawDomain}`;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== "/")) {
    throw new Error("Invalid Cognito sign-in domain. Use the domain prefix or an HTTPS hostname.");
  }
  return parsed.origin;
}

function assertRegisteredSite() {
  if (window.location.origin + "/" !== REGISTERED_CALLBACK) {
    throw new Error("Cognito pilot sign-in is configured only for the registered rbrmain_employee website. This browser's origin is not registered.");
  }
}

function randomBase64Url(n = 32) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function encodeBase64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function decodeClaims(idToken) {
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const base = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base.padEnd(Math.ceil(base.length / 4) * 4, "=")));
  } catch { return null; }
}

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); }
  catch { return null; }
}

function writeSession(tokens, previous = null) {
  if (!tokens?.id_token) throw new Error("Cognito did not return an ID token.");
  const claims = decodeClaims(tokens.id_token);
  if (!claims || claims.iss !== `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` ||
      claims.aud !== CLIENT_ID || claims.token_use !== "id" || !claims.sub ||
      Number(claims.exp || 0) <= Date.now() / 1000) {
    throw new Error("Cognito returned an ID token with unexpected claims. Sign-in was not accepted.");
  }
  const session = {
    idToken: tokens.id_token,
    refreshToken: tokens.refresh_token || previous?.refreshToken || "",
    exp: Number(claims.exp),
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

function authDisplay(session) {
  if (!session?.idToken) return { status: "signedout", email: "", allowed: false };
  const claims = decodeClaims(session.idToken);
  if (!claims || Number(claims.exp || 0) <= Date.now() / 1000) return { status: "signedout", email: "", allowed: false };
  const groups = Array.isArray(claims["cognito:groups"]) ? claims["cognito:groups"] : [];
  return {
    status: "authenticated",
    email: String(claims.email || claims["cognito:username"] || "Signed-in user"),
    allowed: groups.includes(MANAGER_GROUP),
  };
}

async function tokenRequest(body) {
  const response = await fetch(`${cognitoDomain()}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Cognito login failed (${response.status}): ${String(data.error_description || data.error || "Unable to exchange authorization code").slice(0, 180)}`);
  return data;
}

async function refreshSession() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const old = readSession();
    if (!old?.refreshToken) throw new Error("RBR login expired. Sign in again.");
    try {
      const tokens = await tokenRequest({
        grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: old.refreshToken,
      });
      return writeSession(tokens, old);
    } catch (error) {
      sessionStorage.removeItem(SESSION_KEY);
      throw error;
    }
  })();
  try { return await refreshInFlight; }
  finally { refreshInFlight = null; }
}

export const cognitoPilotIsConfigured = Boolean(rawDomain && CLIENT_ID);

export async function startRbrCognitoLogin() {
  if (!rawDomain || !CLIENT_ID) throw new Error("Set VITE_RBR_COGNITO_DOMAIN and VITE_RBR_COGNITO_CLIENT_ID on the rbrmain_employee Amplify app.");
  assertRegisteredSite();
  const verifier = randomBase64Url(48);
  const challenge = encodeBase64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const state = randomBase64Url(24);
  const nonce = randomBase64Url(24);
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, nonce, createdAt: Date.now() }));
  sessionStorage.setItem(RETURN_TAB_KEY, "website-searches");
  const target = new URL(`${cognitoDomain()}/oauth2/authorize`);
  for (const [name, value] of Object.entries({
    response_type: "code", client_id: CLIENT_ID, redirect_uri: REGISTERED_CALLBACK,
    scope: "openid email", state, nonce, code_challenge_method: "S256", code_challenge: challenge,
  })) target.searchParams.set(name, value);
  window.location.assign(target.toString());
}

export async function initializeRbrCognito() {
  if (initInFlight) return initInFlight;
  initInFlight = (async () => {
    if (!rawDomain) return { status: "unconfigured", email: "", allowed: false };
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.has("code") || params.has("error");
    if (oauthResult) {
      // Clear the code from the browser address bar and history immediately.
      for (const key of ["code", "state", "error", "error_description"]) params.delete(key);
      const sanitized = window.location.pathname + (params.toString() ? `?${params}` : "") + window.location.hash;
      const received = new URLSearchParams(window.location.search);
      window.history.replaceState(null, "", sanitized);
      const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
      sessionStorage.removeItem(PENDING_KEY);
      if (received.has("error")) throw new Error(`Cognito: ${received.get("error_description") || received.get("error")}`);
      if (!pending || Date.now() - Number(pending.createdAt) > 10 * 60 * 1000 ||
          !pending.verifier || !pending.nonce || !pending.state || received.get("state") !== pending.state) {
        throw new Error("Cognito sign-in state did not match this browser. Please sign in again.");
      }
      assertRegisteredSite();
      const tokens = await tokenRequest({
        grant_type: "authorization_code", client_id: CLIENT_ID,
        code: received.get("code"), redirect_uri: REGISTERED_CALLBACK,
        code_verifier: pending.verifier,
      });
      const claims = decodeClaims(tokens.id_token);
      if (!claims || claims.nonce !== pending.nonce) {
        throw new Error("Cognito identity nonce validation failed.");
      }
      writeSession(tokens);
    }
    let current = readSession();
    if (current && current.exp <= Date.now() / 1000 + 60) {
      try { current = await refreshSession(); }
      catch { current = null; }
    }
    return authDisplay(current);
  })();
  try { return await initInFlight; }
  finally { initInFlight = null; }
}

export async function getRbrCognitoIdToken() {
  let current = readSession();
  if (!current) throw new Error("Sign in with RBR Cognito before synchronizing cloud rules.");
  if (current.exp <= Date.now() / 1000 + 90) current = await refreshSession();
  if (!authDisplay(current).allowed) throw new Error("Your RBR Cognito account is not in RBRReportsManagers.");
  return current.idToken;
}

export function endRbrCognitoLogin() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  sessionStorage.removeItem(RETURN_TAB_KEY);
  if (!rawDomain) return;
  assertRegisteredSite();
  const target = new URL(`${cognitoDomain()}/logout`);
  target.searchParams.set("client_id", CLIENT_ID);
  target.searchParams.set("logout_uri", REGISTERED_CALLBACK);
  window.location.assign(target.toString());
}

export function consumeRbrCognitoReturnTab() {
  const tab = sessionStorage.getItem(RETURN_TAB_KEY);
  sessionStorage.removeItem(RETURN_TAB_KEY);
  return tab;
}
