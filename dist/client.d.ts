export { HUB_URL, hasNotrackCookie } from "./cookie.js";
export declare function getOrCreateVisitorId(): string;
/**
 * Only the red "back" button, for sites that track nothing (e.g. a child's static page).
 * useTrack already includes it.
 */
export declare function useBackButton(): void;
/**
 * Tracks pageviews (+ one `engaged` per page) of the page/layout it is in.
 * @param site  Analytics surface name stored in Qviks ("mikistec", "joymeseci", ...).
 *
 * Deliberately NOT using useSearchParams(): that hook opts the entire subtree into
 * dynamic rendering. UTM params are read from window.location.search inside the effect.
 */
export declare function useTrack(site: string): void;
/**
 * Fire a custom event (CTA click, signup, booking).
 * Uses sendBeacon so the request survives navigations away from the page.
 */
export declare function trackEvent(site: string, event: "cta_click" | "signup" | "booking", meta?: Record<string, unknown>): void;
/**
 * Green dot, top left, only in a browser that opted out of tracking. Links to
 * the switch for all our sites. Inline styles: no Tailwind scan of node_modules.
 */
export declare function NotrackDot({ zIndex }: {
    zIndex?: number;
}): import("react/jsx-runtime").JSX.Element | null;
/** One line in a layout: tracking for `site` + the green dot. */
export declare function QviksTracker({ site, dot }: {
    site: string;
    dot?: boolean;
}): import("react/jsx-runtime").JSX.Element | null;
export type LeadFormStatus = "idle" | "sending" | "sent" | "error";
/** Name of the hidden honeypot field; humans never fill it, bots do. */
export declare const HONEYPOT_FIELD = "hp_url";
/**
 * Runs the invisible Cloudflare Turnstile widget once for `siteKey` and returns its
 * token ("" on failure or after 15 s). Loads the script on first use only.
 */
export declare function getTurnstileToken(siteKey: string): Promise<string>;
export type PostLeadOptions = {
    /** Default "/api/lead". */
    endpoint?: string;
    /** performance.now() when the form became fillable; elapsedMs counts from it. Default: page load. */
    startedAt?: number;
    /** Error when the human check still fails after a fresh token. */
    humanError?: string;
};
/**
 * Drop-in for fetch(endpoint, { method: "POST", body: JSON.stringify(body) }) to a
 * createLeadHandler route: adds `elapsedMs` (fill time) and an invisible Turnstile token
 * when the server asks for one (its answer carries the site key, cached), with one retry
 * on a failed or expired token. If the human check still fails, the Response is
 * 400 { error: humanError }, so forms that show data.error stay readable.
 */
export declare function postLead(body: Record<string, unknown>, opts?: PostLeadOptions): Promise<Response>;
export type LeadFormOptions = {
    endpoint?: string;
    /** Server-side form key (createLeadHandler `forms`). */
    form?: string;
    /** Shown when the server sent no message, or the network failed. */
    fallbackError?: string;
    /** Network failure (offline). Default: fallbackError. */
    offlineError?: string;
    /** 429 (too many tries). Default: the server's message. */
    tooManyError?: string;
    /** The human check failed even with a fresh token. */
    humanError?: string;
    /** More fields for every send (page language, UTM tags...). */
    extra?: () => Record<string, unknown>;
    /** Clear the form after a successful send. Default true. */
    resetOnSent?: boolean;
};
/**
 * Headless contact form: the site keeps its own markup and copy, this posts it.
 *   const { status, error, onSubmit } = useLeadForm({ fallbackError: "..." });
 *   <form onSubmit={onSubmit}><input name="name" /><input name="email" type="email" />
 *     <textarea name="message" /><LeadHoneypot /><button disabled={status === "sending"}>...</button></form>
 * Every named field is sent as JSON through postLead() (fill time from mount + Turnstile)
 * to `endpoint` (createLeadHandler in @qviks/track/server); `form` picks the server-side
 * form entry. `error` is the server's message whatever the status (never hidden),
 * else `fallbackError`. `send(fields)` posts fields from a widget without a <form>.
 * `data` is the last JSON answer.
 */
export declare function useLeadForm({ endpoint, form, fallbackError, offlineError, tooManyError, humanError, extra, resetOnSent, }?: LeadFormOptions): {
    status: LeadFormStatus;
    error: string | null;
    data: Record<string, unknown> | null;
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
    send: (fields: Record<string, unknown>) => Promise<{
        status: number;
        data: Record<string, unknown>;
    } | null>;
    reset: () => void;
};
/** The honeypot input, hidden from people and screen readers. Inline styles: no Tailwind scan of node_modules. */
export declare function LeadHoneypot(): import("react/jsx-runtime").JSX.Element;
