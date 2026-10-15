"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { HUB_URL, NOTRACK_MAX_AGE, VISITOR_COOKIE, hasNotrackCookie } from "./cookie.js";

export { HUB_URL, hasNotrackCookie } from "./cookie.js";

/** Same-origin relay (createTrackHandler in @qviks/track/server). The browser never calls Qviks. */
const ENDPOINT = "/api/track";

// Module-level dedupe cache: catches StrictMode double-mount AND remounts
// triggered by Provider tree changes (theme/locale switch, layout swap).
// Keyed by `site|pathname`; entries auto-expire after DEDUPE_WINDOW_MS.
const recentTracks = new Map<string, number>();
const DEDUPE_WINDOW_MS = 5_000;
// `site|pathname` -> the recentTracks timestamp of the pageview whose `engaged`
// was already sent, so a remount listens again but never sends it twice.
const engagedFor = new Map<string, number>();

// Engagement = the human signal. A pageview is recorded for everyone (bots that
// run JS included); `engaged` follows only once the page was VISIBLE for a while
// AND got a real input (scroll, wheel, pointer, touch, key). Most bots load and
// leave within a second or never touch the page, so "has engaged" is what the
// report counts as a human visit. Not proof: a scripted headless browser can
// fake it, but that is rare at our volumes and the signals are kept in meta.
const ENGAGE_MIN_VISIBLE_MS = 3_000;
// Visible this long with no input at all still counts (reading a short page on a
// phone without touching it), flagged as via "time" so it can be told apart.
const ENGAGE_TIME_ONLY_MS = 30_000;
const ENGAGE_INPUTS = ["scroll", "wheel", "pointerdown", "pointermove", "touchstart", "keydown"] as const;

export function getOrCreateVisitorId(): string {
  // Fallback for non-secure contexts (http on LAN, older Safari)
  const newId = crypto.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now()}`;
  let id: string = newId;
  try {
    const stored = localStorage.getItem("qviks-vid");
    if (stored) id = stored;
    else localStorage.setItem("qviks-vid", newId);
  } catch {
    // localStorage blocked (private mode, storage full, etc.)
  }
  // Mirror for the server side (lead form -> the visit it came from), refreshed on every call.
  try {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${VISITOR_COOKIE}=${id}; Path=/; Max-Age=${NOTRACK_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    // no document (not in a browser)
  }
  return id;
}

// sendBeacon survives unload and doesn't open a fetch lifecycle:
// ~half the client overhead vs. fetch() for fire-and-forget.
function sendTrack(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    return;
  }
  fetch(ENDPOINT, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {});
}

/**
 * Tracks pageviews (+ one `engaged` per page) of the page/layout it is in.
 * @param site  Analytics surface name stored in Qviks ("mikistec", "joymeseci", ...).
 *
 * Deliberately NOT using useSearchParams(): that hook opts the entire subtree into
 * dynamic rendering. UTM params are read from window.location.search inside the effect.
 */
export function useTrack(site: string) {
  const pathname = usePathname();

  useEffect(() => {
    // Owner opt-out: the relay drops these beacons anyway, skipping saves the
    // requests. ?notrack=1|0 is handled server-side (notrackRedirect).
    if (hasNotrackCookie(document.cookie)) return;

    const key = `${site}|${pathname}`;
    const now = Date.now();
    const last = recentTracks.get(key);
    const isDuplicate = !!last && now - last < DEDUPE_WINDOW_MS;
    if (!isDuplicate) recentTracks.set(key, now);
    const pageviewAt = isDuplicate ? last : now;

    const visitorId = getOrCreateVisitorId();
    const sp = new URLSearchParams(window.location.search);
    // ?p= : per-recipient token on prospect demo links (/demo/<slug>?p=<contact id>).
    // Kept in meta so a visit can be tied back to the contact who was mailed the
    // link. No token = the visit is recorded but belongs to nobody.
    const p = sp.get("p");
    // Ad click ids: FB in-app browser often drops the referrer, fbclid survives.
    const click = sp.has("fbclid") ? "fb" : sp.has("gclid") ? "google" : undefined;
    const meta = p || click ? { p: p ?? undefined, click } : undefined;
    if (!isDuplicate) sendTrack({
      site,
      path: pathname,
      referrer: document.referrer || undefined,
      utm_source: sp.get("utm_source") ?? undefined,
      utm_medium: sp.get("utm_medium") ?? undefined,
      utm_campaign: sp.get("utm_campaign") ?? undefined,
      visitor_id: visitorId,
      event: "pageview",
      meta,
      wd: navigator.webdriver || undefined,
    });

    const stopClicks = trackClicks(site, pathname, visitorId);
    const stopEngaged = trackEngaged();
    return () => {
      stopClicks();
      stopEngaged?.();
    };

    // ─── Engagement ─────────────────────────────────────────────────────────
    function trackEngaged(): (() => void) | undefined {
      if (engagedFor.get(key) === pageviewAt) return;
      const start = Date.now();
      let visibleMs = 0;
      let visibleSince: number | null = document.visibilityState === "visible" ? start : null;
      let input: string | null = null;
      let done = false;

      const elapsedVisible = () => visibleMs + (visibleSince ? Date.now() - visibleSince : 0);
      const check = () => {
        if (done) return;
        const ms = elapsedVisible();
        const via = input && ms >= ENGAGE_MIN_VISIBLE_MS ? input : ms >= ENGAGE_TIME_ONLY_MS ? "time" : null;
        if (!via) return;
        done = true;
        engagedFor.set(key, pageviewAt!);
        cleanup();
        sendTrack({
          site,
          path: pathname,
          visitor_id: visitorId,
          event: "engaged",
          meta: { via, ms: Math.round(ms), p: p ?? undefined },
          wd: navigator.webdriver || undefined,
        });
      };
      const onInput = (e: Event) => {
        // isTrusted = generated by the user agent, not dispatchEvent() from a script.
        if (!e.isTrusted || input) return;
        input = e.type === "pointerdown" || e.type === "pointermove" ? "pointer" : e.type === "touchstart" ? "touch" : e.type;
        check();
      };
      const onVisibility = () => {
        if (document.visibilityState === "visible") visibleSince ??= Date.now();
        else if (visibleSince) {
          visibleMs += Date.now() - visibleSince;
          visibleSince = null;
        }
      };
      const timer = window.setInterval(check, 1_000);
      const cleanup = () => {
        window.clearInterval(timer);
        for (const t of ENGAGE_INPUTS) window.removeEventListener(t, onInput, { capture: true });
        document.removeEventListener("visibilitychange", onVisibility);
      };
      // capture: `scroll` doesn't bubble, and many pages scroll an inner
      // overflow container (window.scrollY stays 0), so listen on the way down.
      for (const t of ENGAGE_INPUTS) window.addEventListener(t, onInput, { passive: true, capture: true });
      document.addEventListener("visibilitychange", onVisibility);
      return cleanup;
    }
  }, [pathname, site]);
}

// ─── Clicks ─────────────────────────────────────────────────────────────────
// Clicks on links and buttons only (never empty space, never what was typed),
// kept in memory and sent as ONE `clicks` event when the page is hidden or left
// (the standard analytics pattern: visibilitychange -> sendBeacon).
const CLICKABLE = "a[href],button,[role=button],input[type=submit],input[type=button]";
const CLICKS_MAX_BYTES = 900; // Qviks drops meta over 1024 bytes

function clickLabel(el: Element): string {
  const raw = el.getAttribute("aria-label") || (el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute("title") || "";
  return raw.replace(/\s+/g, " ").trim().slice(0, 40);
}

function trackClicks(site: string, path: string, visitorId: string): () => void {
  const start = Date.now();
  let clicks: { l: string; h?: string; s: number }[] = [];
  let total = 0;

  const flush = () => {
    if (!total || hasNotrackCookie(document.cookie)) return;
    // Oldest first; drop the newest ones that don't fit, `n` still counts them all.
    let list = clicks;
    while (list.length && new TextEncoder().encode(JSON.stringify(list)).length > CLICKS_MAX_BYTES) list = list.slice(0, -1);
    sendTrack({ site, path, visitor_id: visitorId, event: "clicks", meta: { n: total, c: list }, wd: navigator.webdriver || undefined });
    clicks = [];
    total = 0;
  };
  const onClick = (e: MouseEvent) => {
    if (!e.isTrusted) return;
    const el = (e.target as Element | null)?.closest?.(CLICKABLE);
    if (!el) return;
    total++;
    const href = el.getAttribute("href") ?? undefined;
    clicks.push({ l: clickLabel(el), h: href?.slice(0, 80), s: Math.round((Date.now() - start) / 1000) });
  };
  const onHide = () => {
    if (document.visibilityState === "hidden") flush();
  };

  document.addEventListener("click", onClick, { capture: true, passive: true });
  document.addEventListener("visibilitychange", onHide);
  return () => {
    document.removeEventListener("click", onClick, { capture: true });
    document.removeEventListener("visibilitychange", onHide);
    flush(); // client-side navigation to another page
  };
}

/**
 * Fire a custom event (CTA click, signup, booking).
 * Uses sendBeacon so the request survives navigations away from the page.
 */
export function trackEvent(site: string, event: "cta_click" | "signup" | "booking", meta?: Record<string, unknown>) {
  if (hasNotrackCookie(document.cookie)) return;
  sendTrack({
    site,
    path: window.location.pathname,
    event,
    meta,
    visitor_id: getOrCreateVisitorId(),
    wd: navigator.webdriver || undefined,
  });
}

/**
 * Green dot, top left, only in a browser that opted out of tracking. Links to
 * the switch for all our sites. Inline styles: no Tailwind scan of node_modules.
 */
export function NotrackDot({ zIndex = 2147483647 }: { zIndex?: number }) {
  const [off, setOff] = useState(false);
  // The cookie exists only in the browser: read after mount, no hydration mismatch.
  useEffect(() => setOff(hasNotrackCookie(document.cookie)), []);
  if (!off) return null;
  return (
    <a
      href={HUB_URL}
      title="Your visits are not counted"
      aria-label="Tracking off for this browser"
      style={{
        position: "fixed",
        left: 6,
        top: 6,
        zIndex,
        width: 10,
        height: 10,
        borderRadius: 9999,
        background: "#10b981",
        boxShadow: "0 0 0 2px rgba(255,255,255,0.8)",
      }}
    />
  );
}

/** One line in a layout: tracking for `site` + the green dot. */
export function QviksTracker({ site, dot = true }: { site: string; dot?: boolean }) {
  useTrack(site);
  return dot ? <NotrackDot /> : null;
}

// ─── Contact forms ──────────────────────────────────────────────────────────

export type LeadFormStatus = "idle" | "sending" | "sent" | "error";

/** Name of the hidden honeypot field; humans never fill it, bots do. */
export const HONEYPOT_FIELD = "hp_url";

/**
 * Headless contact form: the site keeps its own markup and copy, this posts it.
 *   const { status, error, onSubmit } = useLeadForm();
 *   <form onSubmit={onSubmit}><input name="name" /><input name="email" type="email" />
 *     <textarea name="message" /><LeadHoneypot /><button disabled={status === "sending"}>...</button></form>
 * Every named field is sent as JSON to `endpoint` (createLeadHandler in
 * @qviks/track/server); `form` picks the server-side form entry. `error` is the
 * server's message or `fallbackError`. The form is reset after a successful send.
 */
export function useLeadForm({
  endpoint = "/api/lead",
  form,
  fallbackError = "Could not send. Please try again.",
}: { endpoint?: string; form?: string; fallbackError?: string } = {}) {
  const [status, setStatus] = useState<LeadFormStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget;
    const data: Record<string, string> = {};
    new FormData(el).forEach((v, k) => {
      if (typeof v === "string") data[k] = v;
    });
    // Ties the lead to the visits before it (cookie qviks_vid), unless tracking is off.
    if (!hasNotrackCookie(document.cookie)) getOrCreateVisitorId();
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form ? { ...data, form } : data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(res.status === 400 && body?.error ? body.error : fallbackError);
        setStatus("error");
        return;
      }
      el.reset();
      setStatus("sent");
    } catch {
      setError(fallbackError);
      setStatus("error");
    }
  }

  return { status, error, onSubmit, reset: () => setStatus("idle") };
}

/** The honeypot input, hidden from people and screen readers. Inline styles: no Tailwind scan of node_modules. */
export function LeadHoneypot() {
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
      <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
    </div>
  );
}
