import { HUB_ORIGIN, HUB_URL, NOTRACK_COOKIE, NOTRACK_MAX_AGE, hasNotrackCookie, visitorIdFromCookie } from "./cookie.js";

export { HUB_ORIGIN, HUB_URL, NOTRACK_COOKIE, NOTRACK_MAX_AGE, VISITOR_COOKIE, hasNotrackCookie, visitorIdFromCookie } from "./cookie.js";

/*
 * Server side for a site that tracks into Qviks. Plain Web Request/Response,
 * so it works in route handlers and in middleware/proxy alike.
 *
 *   app/api/track/route.ts    export const POST = createTrackHandler({ key: process.env.QVIKS_API_KEY })
 *   app/api/notrack/route.ts  export const GET = createNotrackHandler()
 *   middleware / proxy        const r = notrackRedirect(req) ?? linkRedirect(req); if (r) return r;
 */

const QVIKS_TIMEOUT_MS = 5000;
const QVIKS_APP_DOMAIN = "qviks.com";

const json = (body: unknown, status = 200) => Response.json(body, { status });

const hostOf = (req: Request) => (req.headers.get("host") || new URL(req.url).host).toLowerCase();

/** localhost, 127.0.0.1, LAN and *.vercel.app previews: no chain through production, no Domain on cookies. */
export function isPreviewHost(host: string): boolean {
  const h = host.split(":")[0].toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost") || /^192\.168\./.test(h) || h.endsWith(".vercel.app");
}

/** The domain a cookie set on `host` should cover: qviks.com for *.qviks.com, else host minus www. */
export function cookieDomain(host: string): string {
  const h = host.split(":")[0].toLowerCase();
  if (h === QVIKS_APP_DOMAIN || h.endsWith(`.${QVIKS_APP_DOMAIN}`)) return QVIKS_APP_DOMAIN;
  return h.replace(/^www\./, "");
}

/* ─── POST /api/track ───────────────────────────────────────────────────── */

export type Visitor = {
  /** Analytics visitor id (cookie qviks_vid), ties a lead / chat to the visits before it. */
  id?: string | null;
  ip?: string | null;
  ua?: string | null;
  referer?: string | null;
  host?: string | null;
  country?: string | null;
  city?: string | null;
};

/** Visitor context from the incoming browser request (forwarded as x-qviks-visitor-*). */
export function visitorFrom(req: Request): Visitor {
  const h = req.headers;
  return {
    id: visitorIdFromCookie(h.get("cookie")),
    ip: h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null,
    ua: h.get("user-agent"),
    referer: h.get("referer"),
    host: h.get("host"),
    country: h.get("x-vercel-ip-country"),
    city: h.get("x-vercel-ip-city"),
  };
}

export function visitorHeaders(v: Visitor): Record<string, string> {
  const out: Record<string, string> = {};
  if (v.id) out["x-qviks-visitor-id"] = v.id;
  if (v.ip) out["x-qviks-visitor-ip"] = v.ip;
  if (v.ua) out["x-qviks-visitor-ua"] = v.ua;
  if (v.referer) out["x-qviks-visitor-referer"] = v.referer;
  if (v.host) out["x-qviks-visitor-host"] = v.host;
  if (v.country) out["x-qviks-visitor-country"] = v.country;
  if (v.city) out["x-qviks-visitor-city"] = v.city;
  return out;
}

export type TrackHandlerOptions = {
  /**
   * Qviks API v1 key of the site's org (server-only, never NEXT_PUBLIC_). A
   * function when one app serves many orgs: return null to skip the beacon.
   */
  key: string | undefined | ((req: Request, body: Record<string, unknown>) => string | null | undefined);
  /** Qviks base URL. Default: process.env.QVIKS_API_URL. */
  apiUrl?: string;
};

/**
 * Same-origin relay: browser beacon -> Qviks POST /api/v1/track with the key
 * and the visitor headers. Checks only this domain can make (Qviks v1 sees no
 * cookies or Origin): body size, localhost (ANALYTICS_TRACK_LOCALHOST=true to
 * override), the opt-out cookie and the same-origin check. Beacons failing
 * them are not forwarded. Missing config = silently skipped.
 */
export function createTrackHandler(opts: TrackHandlerOptions) {
  return async function POST(req: Request): Promise<Response> {
    const len = Number(req.headers.get("content-length") || 0);
    if (len > 4096) return json({ ok: false }, 413);

    const visitor = visitorFrom(req);
    const host = hostOf(req);
    const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host) || visitor.ip === "127.0.0.1" || visitor.ip === "::1";
    if (local && process.env.ANALYTICS_TRACK_LOCALHOST !== "true") return json({ ok: true, skipped: "localhost" });
    if (hasNotrackCookie(req.headers.get("cookie"))) return json({ ok: true, skipped: "opted-out" });

    let originHost: string | null = null;
    try {
      originHost = new URL(req.headers.get("origin") || "").host.toLowerCase();
    } catch {}
    if (originHost !== host) return json({ ok: true, skipped: "foreign-origin" });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false }, 400);
    const b = body as Record<string, unknown>;

    const key = typeof opts.key === "function" ? opts.key(req, b) : opts.key;
    const base = (opts.apiUrl ?? process.env.QVIKS_API_URL)?.replace(/\/+$/, "");
    if (!key) return json({ ok: true, skipped: "no-key" });
    if (!base) return json({ ok: true, skipped: "no-api-url" });

    try {
      const res = await fetch(`${base}/api/v1/track`, {
        method: "POST",
        signal: AbortSignal.timeout(QVIKS_TIMEOUT_MS),
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...visitorHeaders(visitor),
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(b),
      });
      if (!res.ok) console.error(`[qviks-track] ${String(b.event)} not saved: ${res.status} ${await res.text()}`);
      return json({ ok: res.ok }, res.ok ? 200 : 502);
    } catch (err) {
      console.error(`[qviks-track] ${String(b.event)} failed:`, err instanceof Error ? err.message : err);
      return json({ ok: false }, 502);
    }
  };
}

/* ─── GET /api/notrack ──────────────────────────────────────────────────── */

export type NotrackHandlerOptions = {
  /**
   * Extra hosts `next` may point to. Always allowed: this host's domain and
   * *.qviks.com (the switch and the sites app carry the chain on).
   */
  allowHost?: (host: string) => boolean;
  /**
   * Apps serving several domains (sites): with ?chain=1, hop through these
   * origins (each sets its own cookie) before `next`. This host's domain is skipped.
   */
  chainOrigins?: () => string[];
};

/**
 * GET /api/notrack?v=1|0&next=<url>[&chain=1]: one hop of the switch for all
 * our sites (www.qviks.com/notrack). Sets (v=1) or clears (v=0) the opt-out
 * cookie for this domain, then redirects to `next` if it is a path here or an
 * https URL on an allowed host, else to the switch. No open redirect. Preview
 * hosts set a host-only cookie and never chain.
 */
export function createNotrackHandler(opts: NotrackHandlerOptions = {}) {
  return function GET(req: Request): Response {
    const sp = new URL(req.url).searchParams;
    const on = sp.get("v") !== "0";
    const host = hostOf(req);
    const preview = isPreviewHost(host);
    const origin = `${preview ? new URL(req.url).protocol : "https:"}//${host}`;
    const here = cookieDomain(host);
    const allowed = (h: string) => {
      const d = cookieDomain(h);
      return d === here || d === QVIKS_APP_DOMAIN || !!opts.allowHost?.(h.toLowerCase());
    };

    let target = preview ? `${origin}/` : HUB_URL;
    const next = sp.get("next");
    if (next) {
      try {
        const u = new URL(next, origin);
        const relative = next.startsWith("/") && !next.startsWith("//");
        if (relative || (u.protocol === "https:" && allowed(u.hostname))) target = u.toString();
      } catch {}
    }
    if (sp.get("chain") === "1" && !preview && opts.chainOrigins) {
      const v = on ? "1" : "0";
      const hops = opts.chainOrigins().filter((o) => cookieDomain(new URL(o).host) !== here);
      for (const o of hops.reverse()) target = `${o}/api/notrack?v=${v}&next=${encodeURIComponent(target)}`;
    }

    const headers = new Headers({ Location: target, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    const domain = preview ? "" : `; Domain=${here}`;
    headers.append(
      "Set-Cookie",
      on
        ? `${NOTRACK_COOKIE}=1; Path=/; Max-Age=${NOTRACK_MAX_AGE}${domain}; SameSite=Lax${preview ? "" : "; Secure"}`
        : `${NOTRACK_COOKIE}=; Path=/; Max-Age=0${domain}`
    );
    return new Response(null, { status: 303, headers });
  };
}

/* ─── ?notrack=1|0 on any page (middleware / proxy) ─────────────────────── */

/**
 * For middleware/proxy, first thing:
 *   ?notrack=1|0 on any page -> the switch on Qviks (sets the cookie on all our
 *   domains, comes back here without the param). Preview hosts: only this
 *   host's /api/notrack. /notrack -> the switch page.
 * Returns null when the request is not about notrack.
 */
export function notrackRedirect(req: Request): Response | null {
  const url = new URL(req.url);
  const v = url.searchParams.get("notrack");
  if (v === "1" || v === "0") {
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return null;
    const host = hostOf(req);
    url.searchParams.delete("notrack");
    const path = url.pathname + url.search;
    const location = isPreviewHost(host)
      ? `${url.protocol}//${host}/api/notrack?v=${v}&next=${encodeURIComponent(path)}`
      : `${HUB_ORIGIN}/api/notrack?v=${v}&next=${encodeURIComponent(`https://${host}${path}`)}`;
    return new Response(null, { status: 307, headers: { Location: location, "Cache-Control": "no-store" } });
  }
  // Not on the switch's own host (www.qviks.com/notrack IS the switch).
  const h = hostOf(req).split(":")[0];
  if (url.pathname === "/notrack" && h !== new URL(HUB_ORIGIN).hostname && h !== QVIKS_APP_DOMAIN) {
    return new Response(null, { status: 307, headers: { Location: HUB_URL } });
  }
  return null;
}

/* ─── /q/<code>: tracked short links (middleware / proxy) ───────────────── */

const LINK_RE = /^(.*?)\/q\/([A-Za-z0-9_-]{1,64})(\/.*)?$/;

/**
 * Tracked links for QR codes, posters, campaigns and links sent to one person:
 *   /q/<code>          -> /?utm_source=q&utm_campaign=<code>
 *   /q/<code>/<path>   -> /<path>?utm_source=q&utm_campaign=<code>
 *   /<base>/q/<code>   -> /<base>?...   (apps serving a site under a path prefix)
 * The code says what it is (plagat1, ig-bio, jana); Qviks groups visits by it.
 * Query params on the link are kept. 307: never cached, the target may change.
 * Returns null for any other path.
 */
export function linkRedirect(req: Request): Response | null {
  const url = new URL(req.url);
  const m = LINK_RE.exec(url.pathname);
  if (!m || m[1].startsWith("/api") || m[1].startsWith("/_next")) return null;
  url.pathname = m[1] + (m[3] ?? "") || "/";
  url.searchParams.set("utm_source", "q");
  url.searchParams.set("utm_campaign", m[2].toLowerCase());
  // Absolute: Next middleware rejects a relative Location.
  const location = `${url.protocol}//${hostOf(req)}${url.pathname}${url.search}`;
  return new Response(null, { status: 307, headers: { Location: location, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
