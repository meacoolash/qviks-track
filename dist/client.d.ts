export { HUB_URL, hasNotrackCookie } from "./cookie.js";
export declare function getOrCreateVisitorId(): string;
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
 * Headless contact form: the site keeps its own markup and copy, this posts it.
 *   const { status, error, onSubmit } = useLeadForm();
 *   <form onSubmit={onSubmit}><input name="name" /><input name="email" type="email" />
 *     <textarea name="message" /><LeadHoneypot /><button disabled={status === "sending"}>...</button></form>
 * Every named field is sent as JSON to `endpoint` (createLeadHandler in
 * @qviks/track/server); `form` picks the server-side form entry. `error` is the
 * server's message or `fallbackError`. The form is reset after a successful send.
 */
export declare function useLeadForm({ endpoint, form, fallbackError, }?: {
    endpoint?: string;
    form?: string;
    fallbackError?: string;
}): {
    status: LeadFormStatus;
    error: string | null;
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => Promise<void>;
    reset: () => void;
};
/** The honeypot input, hidden from people and screen readers. Inline styles: no Tailwind scan of node_modules. */
export declare function LeadHoneypot(): import("react/jsx-runtime").JSX.Element;
