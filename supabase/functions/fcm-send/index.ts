// FocusLion — fcm-send Edge Function
//
// Invoked by Postgres triggers (via pg_net) when a notifiable event happens.
// Looks up the target user's device tokens and pushes via Firebase Cloud
// Messaging HTTP v1. Authenticated by a shared secret header (x-fcm-secret),
// NOT a user JWT — so deploy it with:  supabase functions deploy fcm-send --no-verify-jwt
//
// Required function secrets (see supabase/PUSH_SETUP.md):
//   FCM_PROJECT_ID       e.g. focuslion-b6b7a
//   FCM_SERVICE_ACCOUNT  the full Firebase service-account JSON (one line is fine)
//   FCM_TRIGGER_SECRET   a random string; must match push_config.fcm_trigger_secret
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//
// Request body (sent by the SQL senders):
//   { user_id?: uuid, user_ids?: uuid[], broadcast?: boolean,
//     title: string, body: string, tag?: string, data?: object }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROJECT_ID = Deno.env.get("FCM_PROJECT_ID") ?? "";
const TRIGGER_SECRET = Deno.env.get("FCM_TRIGGER_SECRET") ?? "";

// FCM_SERVICE_ACCOUNT may be raw JSON OR base64-encoded JSON. Base64 is the
// safer way to set it as a secret (no embedded quotes/newlines for the shell or
// dotenv parser to mangle).
function loadServiceAccount(): Record<string, string> {
  const raw = (Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "").trim();
  if (!raw) return {} as Record<string, string>;
  const json = raw.startsWith("{")
    ? raw
    : new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)));
  return JSON.parse(json);
}
const SERVICE_ACCOUNT = loadServiceAccount();

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ---- google service-account OAuth (RS256 JWT -> access token) ----
let cached: { token: string; exp: number } | null = null;

function b64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToBuf(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;

  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(enc.encode(JSON.stringify({
    iss: SERVICE_ACCOUNT.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBuf(SERVICE_ACCOUNT.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned));
  const jwt = `${unsigned}.${b64url(sig)}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const json = await resp.json();
  if (!json.access_token) throw new Error("oauth failed: " + JSON.stringify(json));
  cached = { token: json.access_token, exp: now + (json.expires_in ?? 3600) };
  return cached.token;
}

// FCM data payload values must all be strings
function strData(data: Record<string, unknown> | undefined, tag: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (data) for (const [k, v] of Object.entries(data)) out[k] = v == null ? "" : String(v);
  if (tag) out.tag = tag;
  return out;
}

async function sendOne(
  accessToken: string,
  token: string,
  title: string,
  body: string,
  tag: string | null,
  data: Record<string, string>,
): Promise<boolean> {
  // let a sender pick the Android channel (e.g. the loud "calls" channel for
  // incoming calls); default to the general app channel. channel_id travels in
  // `data` but is NOT itself a data field the client needs, so strip it out.
  const channelId = data.channel_id || "focuslion_app";
  const outData = { ...data };
  delete outData.channel_id;
  const message = {
    message: {
      token,
      notification: { title, body },
      data: outData,
      android: {
        priority: "HIGH",
        notification: {
          channel_id: channelId,
          ...(tag ? { tag } : {}),
          ...(channelId === "focuslion_calls"
            ? { notification_priority: "PRIORITY_MAX", default_sound: true, default_vibrate_timings: true }
            : {}),
        },
      },
    },
  };
  const url = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (resp.ok) return true;
    const errText = await resp.text();
    // Prune ONLY a definitively dead token (FCM says UNREGISTERED / 404).
    // Never delete on transient (429/5xx) or config (401/403) errors — that was
    // wrongly removing valid tokens.
    if (resp.status === 404 || errText.includes("UNREGISTERED")) {
      await admin.from("user_push_tokens").delete().eq("fcm_token", token);
      return false;
    }
    // transient — back off and retry; any other 4xx — give up but KEEP the token
    if (resp.status === 429 || resp.status >= 500) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }
    return false;
  }
  return false;
}

Deno.serve(async (req) => {
  if (!TRIGGER_SECRET || req.headers.get("x-fcm-secret") !== TRIGGER_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const { user_id, user_ids, broadcast, title, body, tag, data } = payload ?? {};
  if (!title || !body) return new Response("missing title/body", { status: 400 });

  let query = admin.from("user_push_tokens").select("fcm_token");
  if (broadcast === true) {
    // all tokens
  } else if (Array.isArray(user_ids) && user_ids.length) {
    query = query.in("user_id", user_ids);
  } else if (user_id) {
    query = query.eq("user_id", user_id);
  } else {
    return new Response("no target", { status: 400 });
  }

  const { data: rows, error } = await query;
  if (error) return new Response("db error: " + error.message, { status: 500 });

  const tokens = [...new Set((rows ?? []).map((r: { fcm_token: string }) => r.fcm_token))];
  if (!tokens.length) {
    return new Response(JSON.stringify({ sent: 0, total: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const accessToken = await getAccessToken();
  const sdata = strData(data, tag ?? null);
  let sent = 0;
  await Promise.all(
    tokens.map(async (t) => {
      try {
        if (await sendOne(accessToken, t, title, body, tag ?? null, sdata)) sent++;
      } catch (_) {
        // ignore per-token failures
      }
    }),
  );

  return new Response(JSON.stringify({ sent, total: tokens.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
