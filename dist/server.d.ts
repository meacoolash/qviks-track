export { HUB_ORIGIN, HUB_URL, NOTRACK_COOKIE, NOTRACK_MAX_AGE, VISITOR_COOKIE, hasNotrackCookie, visitorIdFromCookie } from "./cookie.js";
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
export type LeadHandlerOptions = {
    /** Qviks API v1 key of the site's org. A function when one app serves many orgs: null = 404. */
    key: string | undefined | ((req: Request, body: Record<string, unknown>) => string | null | undefined);
    /** Qviks base URL. Default: process.env.QVIKS_API_URL. */
    apiUrl?: string;
    /**
     * Forms this site has, by the `form` key the browser posts. Everything about a
     * form (topic, contact tags, extra fields) is decided here, never by the browser.
     * A post without `form` uses "default"; an unknown `form` is rejected.
     */
    forms?: Record<string, LeadForm>;
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
/**
 * Same-origin relay for contact forms: browser form -> Qviks POST /api/v1/leads
 * with the key and the visitor headers (ties the lead to its visits). Pair it
 * with useLeadForm() from @qviks/track. Guards here: body size, same-origin
 * (foreign posts get a silent 201, bots don't learn the gate), honeypot
 * `hp_url`, form whitelist. Qviks does the rest (validation, 5/min per visitor
 * IP, contact + notification). Qviks status and JSON pass through unchanged;
 * 502 { error } when it is unreachable or the key / URL is missing.
 */
export declare function createLeadHandler(opts: LeadHandlerOptions): (req: Request) => Promise<Response>;
