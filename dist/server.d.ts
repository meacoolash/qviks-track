export { HUB_ORIGIN, HUB_URL, NOTRACK_COOKIE, NOTRACK_MAX_AGE, TEST_HEADER, VISITOR_COOKIE, hasNotrackCookie, testHeaders, visitorIdFromCookie } from "./cookie.js";
/** localhost, 127.0.0.1, LAN and *.vercel.app previews: no chain through production, no Domain on cookies. */
export declare function isPreviewHost(host: string): boolean;
/** The domain a cookie set on `host` should cover: qviks.com for *.qviks.com, else host minus www. */
export declare function cookieDomain(host: string): string;
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
export declare function visitorFrom(req: Request): Visitor;
export declare function visitorHeaders(v: Visitor): Record<string, string>;
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
export declare function createTrackHandler(opts: TrackHandlerOptions): (req: Request) => Promise<Response>;
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
export declare function createNotrackHandler(opts?: NotrackHandlerOptions): (req: Request) => Response;
/**
 * For middleware/proxy, first thing:
 *   ?notrack=1|0 on any page -> the switch on Qviks (sets the cookie on all our
 *   domains, comes back here without the param). Preview hosts: only this
 *   host's /api/notrack. /notrack -> the switch page.
 * Returns null when the request is not about notrack.
 */
export declare function notrackRedirect(req: Request): Response | null;
/**
 * Tracked links for QR codes, posters, campaigns and links sent to one person:
 *   /q/<code>          -> /?utm_source=q&utm_campaign=<code>
 *   /q/<code>/<path>   -> /<path>?utm_source=q&utm_campaign=<code>
 *   /<base>/q/<code>   -> /<base>?...   (apps serving a site under a path prefix)
 * The code says what it is (plagat1, ig-bio, jana); Qviks groups visits by it.
 * Query params on the link are kept. 307: never cached, the target may change.
 * Returns null for any other path.
 */
export declare function linkRedirect(req: Request): Response | null;
export type TurnstileKeys = {
    siteKey: string;
    secret: string;
};
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
    onResult?: (ctx: LeadContext & {
        payload: LeadPayload;
        status: number;
        data: unknown;
    }) => Response | void | Promise<Response | void>;
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
/** Cloudflare Turnstile siteverify; false on any failure (fails closed). */
export declare function verifyTurnstile(secret: string, token: unknown, ip?: string | null): Promise<boolean>;
/** A chat id from the @qviks/chat lead card, or undefined. */
export declare function chatSessionId(v: unknown): string | undefined;
/** The default Qviks payload: what createLeadHandler sends without `prepare`. */
export declare function defaultLeadPayload({ body: b, form, locale }: LeadContext): LeadPayload;
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
export declare function createLeadHandler(opts: LeadHandlerOptions): (req: Request) => Promise<Response>;
