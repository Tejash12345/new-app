// FocusLion — drive-proxy Edge Function
//
// Streams a PUBLIC Google Drive video so it can play in an HTML5 <video>
// element (hence with the app's synced play/pause/seek transport). Drive's
// direct download URL serves an HTML "can't scan for viruses" page for large
// files instead of the bytes — a raw <video> can't play that, which is why
// Watch Together kept falling back to the un-syncable /preview iframe. This
// proxy performs Google's confirm-token handshake server-side, forwards the
// browser's Range header (so seeking works), and streams the video back.
//
// Deploy WITHOUT jwt verification (a <video> can't send an auth header):
//   supabase functions deploy drive-proxy --no-verify-jwt
//
// GET /drive-proxy?id=<fileId>   (file must be shared "Anyone with the link")

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "range, content-type",
  "access-control-expose-headers": "content-length, content-range, accept-ranges, content-type",
};

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BASE = "https://drive.usercontent.google.com/download";

function pick(html: string, name: string): string | null {
  // hidden form field: <input type="hidden" name="confirm" value="XYZ">
  const m = html.match(new RegExp(`name="${name}"\\s+value="([^"]*)"`))
    ?? html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`));
  return m ? m[1] : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return new Response("missing id", { status: 400, headers: CORS });

  const range = req.headers.get("range") ?? undefined;
  const reqHeaders: Record<string, string> = { "User-Agent": UA };
  if (range) reqHeaders["Range"] = range;

  try {
    // 1st hit: small files stream immediately; large files return an HTML
    // confirm page (which ignores Range, so ask without it first)
    let resp = await fetch(`${BASE}?id=${id}&export=download`, { headers: { "User-Agent": UA } });
    let ct = resp.headers.get("content-type") ?? "";

    if (ct.includes("text/html")) {
      const html = await resp.text();
      const confirm = pick(html, "confirm") ?? "t";
      const uuid = pick(html, "uuid");
      const url = `${BASE}?id=${id}&export=download&confirm=${encodeURIComponent(confirm)}` +
        (uuid ? `&uuid=${encodeURIComponent(uuid)}` : "");
      resp = await fetch(url, { headers: reqHeaders });
      ct = resp.headers.get("content-type") ?? "";
    } else if (range) {
      // small file but we skipped Range on the probe — refetch with Range so
      // the <video> gets 206 + seeking
      resp = await fetch(`${BASE}?id=${id}&export=download`, { headers: reqHeaders });
      ct = resp.headers.get("content-type") ?? "";
    }

    if (ct.includes("text/html") || (!resp.ok && resp.status !== 206)) {
      return new Response("drive: not a streamable public file", { status: 502, headers: CORS });
    }

    const out = new Headers(CORS);
    out.set("Content-Type", ct || "video/mp4");
    out.set("Accept-Ranges", "bytes");
    for (const h of ["content-length", "content-range", "cache-control"]) {
      const v = resp.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(resp.body, { status: resp.status, headers: out });
  } catch (_e) {
    return new Response("drive proxy error", { status: 502, headers: CORS });
  }
});
