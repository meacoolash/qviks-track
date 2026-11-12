import { HUB_ORIGIN, HUB_URL, NOTRACK_COOKIE, NOTRACK_MAX_AGE, hasNotrackCookie, testHeaders, visitorIdFromCookie } from "./cookie.js";

export { HUB_ORIGIN, HUB_URL, NOTRACK_COOKIE, NOTRACK_MAX_AGE, TEST_HEADER, VISITOR_COOKIE, hasNotrackCookie, testHeaders, visitorIdFromCookie } from "./cookie.js";

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

/* ─── POST /api/lead: contact forms ─────────────────────────────────────── */

export type TurnstileKeys = { siteKey: string; secret: string };

export type LeadPayload = Record<string, unknown>;

export type LeadContext = {
  req: Request;
  /** The browser's JSON body (without `turnstile` and `elapsedMs`). */
  body: Record<string, unknown>;
  /** The `form` key the browser posted ("default" when none). */
  formKey: string;
  form: LeadForm;
  /** Language: the body's `locale` (sk/cs/en) or the handler's `locale`. */
  locale: string | undefined;
};

export type LeadHandlerOptions = {
  /**
   * Qviks API v1 key of the site's org. A function when one app serves many orgs:
   * null = 404 { error: "Not found" } (no such site), undefined / "" = 502 (key not configured).
   */
  key: string | undefined | ((req: Request, body: Record<string, unknown>) => string | null | undefined);
  /** Qviks base URL. Default: process.env.QVIKS_API_URL. */
  apiUrl?: string;
  /**
   * Forms this site has, by the `form` key the browser posts. Everything about a
   * form (topic, contact tags, extra fields) is decided here, never by the browser.
   * A post without `form` uses "default"; an unknown `form` is rejected.
   */
  forms?: Record<string, LeadForm>;
  /**
   * Language of the site; Qviks mails the owner in it ("sk", "cs", "en").
   * A form may post its own `locale` (multi-language sites). Omit = English.
   * A function for apps serving many sites.
   */
  locale?: "sk" | "cs" | "en" | ((req: Request, body: Record<string, unknown>) => string | undefined);
  /**
   * Invisible Cloudflare Turnstile (1.8.0), the site's own widget keys (server env, never NEXT_PUBLIC_).
   * Set = required for every caller: no or bad token -> 400 { error: "turnstile", turnstile: siteKey }
   * (useLeadForm / postLead fetch a token and resend once). A function for per-site keys.
   * Keys that resolve to nothing: production fails closed (400, logged), outside production the
   * check is skipped (local dev without keys). Omit only on forms that are not public.
   */
  turnstile?: TurnstileKeys | null | undefined | ((req: Request, body: Record<string, unknown>) => TurnstileKeys | null | undefined);
  /**
   * Minimum time between page load (or form mount) and submit, from the browser's `elapsedMs`
   * (1.8.0). Faster or missing = the honeypot's silent { ok: true, saved: false }. Standard: 3000.
   * Default 0 (off) for compatibility.
   */
  minFillMs?: number;
  /**
   * First thing, before the body is read (1.8.0): own origin rules, rate limits. Return a
   * Response to answer with it, null to go on. The handler's same-origin check runs after it.
   */
  guard?: (req: Request) => Response | null | Promise<Response | null>;
  /**
   * Builds the Qviks payload after all bot gates passed (1.8.0). Return a Response to answer
   * the browser directly (validation error, a booking done elsewhere, mail-only form).
   * Default: name, email, phone, message (+ form extras), source, topic, tags, locale, chat_session_id.
   */
  prepare?: (ctx: LeadContext) => LeadPayload | Response | Promise<LeadPayload | Response>;
  /**
   * After Qviks answered, or failed to (502), with that status and JSON (1.8.0). Return a
   * Response to replace the answer (e.g. mail the lead yourself when Qviks is down), or
   * nothing to pass Qviks' answer through. Lost-lead alerts go here.
   */
  onResult?: (
    ctx: LeadContext & { payload: LeadPayload; status: number; data: unknown }
  ) => Response | void | Promise<Response | void>;
};

export type LeadForm = {
  /** Shown in the Qviks notification subject ("Website inquiry", "domskolak.sk"). Max 60 chars. */
  topic?: string;
  /** Contact tags in Qviks, created there if missing (max 5, 40 chars each). */
  tags?: string[];
  /**
   * Qviks capture entry: "lead_form" (wants an answer, lands in the pipeline),
   * "magnet" (newsletter, freebie), "call". Default: Qviks decides
   * (message = lead_form, no message = magnet).
   */
  source?: "lead_form" | "magnet" | "call";
  /** Extra fields (name -> label) folded into the message as "Label: value" lines, 300 chars each. */
  extras?: Record<string, string>;
};

// Qviks keeps the first 1000 characters of a message.
const LEAD_MESSAGE_MAX = 1000;

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare Turnstile siteverify; false on any failure (fails closed). */
export async function verifyTurnstile(secret: string, token: unknown, ip?: string | null): Promise<boolean> {
  if (typeof token !== "string" || !token || token.length > 4096) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch(SITEVERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(QVIKS_TIMEOUT_MS) });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

/** A chat id from the @qviks/chat lead card, or undefined. */
export function chatSessionId(v: unknown): string | undefined {
  return typeof v === "string" && /^[\w-]{8,64}$/.test(v) ? v : undefined;
}

const leadStr = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The default Qviks payload: what createLeadHandler sends without `prepare`. */
export function defaultLeadPayload({ body: b, form, locale }: LeadContext): LeadPayload {
  const extras = Object.entries(form.extras ?? {})
    .map(([field, label]) => [label, leadStr(b[field], 300)] as const)
    .filter(([, value]) => value);
  const text = leadStr(b.message, LEAD_MESSAGE_MAX);
  const message = [...extras.map(([label, value]) => `${label}: ${value}`), ...(extras.length && text ? ["---"] : []), ...(text ? [text] : [])].join("\n");
  const phone = leadStr(typeof b.phone === "string" ? b.phone.replace(/[\u0000-\u001f\u007f]+/g, " ") : "", 40);
  const chat = chatSessionId(b.chat_session_id);
  return {
    name: leadStr(b.name, 120),
    email: leadStr(b.email, 200),
    ...(phone ? { phone } : {}),
    ...(message ? { message } : {}),
    ...(form.source ? { source: form.source } : {}),
    ...(form.topic ? { topic: form.topic } : {}),
    ...(form.tags?.length ? { tags: form.tags } : {}),
    ...(locale ? { locale } : {}),
    // Lead from the @qviks/chat card (1.7.0): Qviks links the chat to the contact and mails the conversation.
    ...(chat ? { chat_session_id: chat } : {}),
  };
}

const isProd = () => process.env.NODE_ENV === "production";

/**
 * Same-origin relay for contact forms: browser form -> Qviks POST /api/v1/leads
 * with the key and the visitor headers (ties the lead to its visits). Pair it
 * with useLeadForm() / postLead() from @qviks/track. Gates, in order: body size,
 * `guard`, same-origin (foreign posts get a silent 201, bots don't learn the gate),
 * honeypot `hp_url`, `minFillMs`, Turnstile, form whitelist. Qviks does the rest
 * (validation, 5/min per visitor IP, contact + notification). Qviks status and JSON
 * pass through unchanged (errors reach the visitor); 502 { error } when it is
 * unreachable or the URL / key is missing, 404 when a key function returns null.
 */
export function createLeadHandler(opts: LeadHandlerOptions) {
  const forms = opts.forms ?? { default: {} };
  return async function POST(req: Request): Promise<Response> {
    const len = Number(req.headers.get("content-length") || 0);
    if (len > 16_384) return json({ error: "Invalid request" }, 413);

    if (opts.guard) {
      const stop = await opts.guard(req);
      if (stop) return stop;
    }

    const host = hostOf(req);
    let originHost: string | null = null;
    try {
      originHost = new URL(req.headers.get("origin") || req.headers.get("referer") || "").host.toLowerCase();
    } catch {}
    if (originHost !== host) return json({ ok: true }, 201);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "Invalid request" }, 400);
    const { turnstile: token, elapsedMs, ...b } = raw as Record<string, unknown>;

    const fakeSuccess = () => json({ ok: true, saved: false });
    if (typeof b.hp_url === "string" && b.hp_url.trim() !== "") return fakeSuccess();

    const minFill = opts.minFillMs ?? 0;
    if (minFill > 0 && !(typeof elapsedMs === "number" && Number.isFinite(elapsedMs) && elapsedMs >= minFill)) return fakeSuccess();

    if (opts.turnstile !== undefined) {
      const keys = typeof opts.turnstile === "function" ? opts.turnstile(req, b) : opts.turnstile;
      const noStore = { "Cache-Control": "no-store" };
      if (!keys?.siteKey || !keys.secret) {
        if (isProd()) {
          console.error(`[qviks-lead] Turnstile keys missing in production (${host}): form blocked`);
          return Response.json({ error: "turnstile" }, { status: 400, headers: noStore });
        }
      } else if (!(await verifyTurnstile(keys.secret, token, visitorFrom(req).ip))) {
        // The site key rides along (no NEXT_PUBLIC_ env); the browser gets a token and resends.
        return Response.json({ error: "turnstile", turnstile: keys.siteKey }, { status: 400, headers: noStore });
      }
    }

    const formKey = typeof b.form === "string" && b.form ? b.form : "default";
    const form = Object.hasOwn(forms, formKey) ? forms[formKey] : null;
    if (!form) return json({ error: "Unknown form." }, 400);

    const rawLocale = typeof opts.locale === "function" ? opts.locale(req, b) : opts.locale;
    const locale = b.locale === "sk" || b.locale === "cs" || b.locale === "en" ? b.locale : rawLocale;
    const ctx: LeadContext = { req, body: b, formKey, form, locale };

    const prepared = opts.prepare ? await opts.prepare(ctx) : defaultLeadPayload(ctx);
    if (prepared instanceof Response) return prepared;
    const payload = prepared;

    const finish = async (status: number, data: unknown): Promise<Response> => {
      const replaced = opts.onResult ? await opts.onResult({ ...ctx, payload, status, data }) : undefined;
      return replaced ?? json(data, status);
    };

    const key = typeof opts.key === "function" ? opts.key(req, b) : opts.key;
    if (key === null) return json({ error: "Not found" }, 404);
    const base = (opts.apiUrl ?? process.env.QVIKS_API_URL)?.replace(/\/+$/, "");
    if (!key || !base) {
      console.error(`[qviks-lead] ${!key ? "no key" : "QVIKS_API_URL is not set"}; lead not sent`);
      return finish(502, { error: "Could not send. Please try again." });
    }

    let res: Response;
    try {
      res = await fetch(`${base}/api/v1/leads`, {
        method: "POST",
        signal: AbortSignal.timeout(QVIKS_TIMEOUT_MS),
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          // Opted out of tracking: the lead is not tied to past visits either.
          ...visitorHeaders({ ...visitorFrom(req), ...(hasNotrackCookie(req.headers.get("cookie")) ? { id: null } : {}) }),
          // Tester mode: Qviks files the lead as a test, the site's admin never sees it.
          ...testHeaders(req.headers.get("cookie")),
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error("[qviks-lead] failed:", err instanceof Error ? err.message : err);
      return finish(502, { error: "Could not send. Please try again." });
    }
    const resText = await res.text();
    let out: unknown;
    try {
      out = resText ? JSON.parse(resText) : {};
    } catch {
      out = res.ok ? { ok: true } : { error: "Could not send. Please try again." };
    }
    if (!res.ok) console.error(`[qviks-lead] not saved: ${res.status} ${resText}`);
    return finish(res.status, out);
  };
}
