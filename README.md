# @qviks/track

Visit tracking and contact forms for our Next.js sites, stored in [Qviks](https://www.qviks.com) analytics.

- **Pageview + `engaged`**: every pageview is recorded (bots included); `engaged` follows once the page
  was visible 3s+ with real input (scroll, pointer, touch, key) or 30s without input. Qviks labels a
  visit human / unverified / bot from that.
- **Clicks**: clicks on links and buttons (label, href, second on the page; never empty space or typed
  text) are kept in memory and sent as one `clicks` event when the page is hidden or left.
- **Server relay**: the browser only calls its own `/api/track`; the server forwards to Qviks API v1
  with the org key. No key ever reaches the browser.
- **Tracked links `/q/<code>`**: `/q/plagat1` (QR, poster), `/q/ig-bio`, `/q/jana/seminare` (a link sent to
  one person, to a subpage) redirect to the page with `utm_source=q&utm_campaign=<code>`. No registry: a new
  poster or person is just a new code. Qviks shows visits and leads per code.
- **Lead -> visit**: the visitor id is mirrored into the `qviks_vid` cookie and forwarded with server calls
  (`visitorFrom`), so Qviks ties a form submission to the visits before it.
- **Contact forms**: `useLeadForm()` / `postLead()` post any form to the site's own `/api/lead`;
  `createLeadHandler` checks origin + honeypot, whitelists the form, and forwards to Qviks
  `/api/v1/leads` with the visitor id, so the lead shows on its visits. Topic, tags and extra
  fields are decided on the server, never by the browser. 1.8.0: invisible Turnstile with per-site keys
  (`turnstile`), minimum fill time (`minFillMs`, standard 3000), hooks `guard` (origin rules, rate limits),
  `prepare` (own payload or a direct answer) and `onResult` (lost-lead alert, mail fallback), `phone`
  forwarded, and every server error message reaches the visitor (useLeadForm shows it whatever the status). A `chat_session_id` from the `@qviks/chat` lead card is
  passed through (1.7.0), so Qviks links that chat to the contact.
- **Owner opt-out**: one switch at [www.qviks.com/notrack](https://www.qviks.com/notrack) sets a cookie
  on every domain we track (each domain serves `/api/notrack`). A green dot top left shows it.
- **Tester mode** (1.3.0): the same switch. With it on, `createLeadHandler` adds `x-qviks-test: 1`
  (`testHeaders(cookie)` for sites with their own lead relay) and Qviks files the lead in Miki's
  tests org: the site's admin gets no email, no bell and no new lead.

- **Back button** (1.5.0): a link to one of our sites with `?from=mikistec/<lang>` (mikistec portfolio) makes
  `useTrack` show a red "← Späť na / Back to mikistec.com" button, bottom left, on every page of that site for
  the rest of the tab session. Entering the site again without `?from=` and not from its own pages
  (typed URL, bookmark, search) removes it (1.5.1). It leads to `mikistec.com/<lang>#work`. Only keys in `BACK_TARGETS` are accepted.
  No consumer code needed, only the version bump.
  1.6.0: `?from=mikistec/<lang>/<page>` returns to `mikistec.com/<lang>/<page>` instead (page = `[a-z0-9-]+`),
  and `useBackButton()` gives the button alone to sites that track nothing (e.g. maxkocak.com).

No secrets live here: keys come from each project's environment.

## Install

```sh
bun add github:meacoolash/qviks-track#v1.8.0
```

Env (server only): `QVIKS_API_URL`, and the org key, e.g. `QVIKS_API_KEY`.

## Wire up (3 files + 1 line)

```tsx
// app/layout.tsx (inside <body>)
import { QviksTracker } from "@qviks/track";
<QviksTracker site="mysite" />

// app/api/track/route.ts
import { createTrackHandler } from "@qviks/track/server";
export const POST = createTrackHandler({ key: process.env.QVIKS_API_KEY });

// app/api/notrack/route.ts
import { createNotrackHandler } from "@qviks/track/server";
export const GET = createNotrackHandler();

// middleware.ts / proxy.ts, first thing
import { linkRedirect, notrackRedirect } from "@qviks/track/server";
const r = notrackRedirect(req) ?? linkRedirect(req);
if (r) return r;
```

Contact form (optional):

```tsx
// app/api/lead/route.ts
import { createLeadHandler } from "@qviks/track/server";
export const POST = createLeadHandler({
  key: process.env.QVIKS_API_KEY,
  forms: { default: { topic: "mysite.com", tags: ["Web Form"], source: "lead_form" } },
  locale: "sk", // owner's notification email in Slovak ("sk" | "cs" | "en", default English)
  // Always on public forms (site standard). The site's OWN widget keys, server env only.
  turnstile: { siteKey: process.env.TURNSTILE_SITE_KEY!, secret: process.env.TURNSTILE_SECRET_KEY! },
  minFillMs: 3000,
});

// the form (client component): own markup, named fields name / email / message (+ form extras)
import { useLeadForm, LeadHoneypot } from "@qviks/track";
const { status, error, onSubmit } = useLeadForm({ fallbackError: "Nepodarilo sa odoslať." });
<form onSubmit={onSubmit}>...<LeadHoneypot /></form>
// own form state instead: const res = await postLead({ name, email, message, hp_url })
```

Turnstile: without a token (or with a bad one) the handler answers 400 `{ error: "turnstile", turnstile: siteKey }`;
`postLead` runs the invisible widget, caches the key and resends once. Keys that resolve to nothing fail closed in
production and are skipped outside it. Local tests: Cloudflare always-pass keys `1x00000000000000000000AA` /
`1x0000000000000000000000000000000AA`. A function `turnstile: (req, body) => keys | null` gives per-site keys,
`key: (req, body) => ...` returning `null` answers 404 (apps serving many sites, e.g. `sites`).
Gates run in this order: size, `guard`, same-origin (silent 201), honeypot, `minFillMs` (silent 200 saved:false), Turnstile, form whitelist.

Then add the domain to the switch's chain in Qviks (`src/lib/notrack.ts`, `STANDALONE_ORIGINS`).
Sites served by the `sites` app are covered automatically.

Custom events: `trackEvent("mysite", "cta_click", { target: "whatsapp" })`.

## Exports

| Path | |
|---|---|
| `@qviks/track` (client) | `QviksTracker`, `useTrack`, `useBackButton`, `trackEvent`, `NotrackDot`, `useLeadForm`, `postLead`, `getTurnstileToken`, `LeadHoneypot`, `getOrCreateVisitorId`, `hasNotrackCookie`, `HUB_URL` |
| `@qviks/track/server` | `createTrackHandler`, `createLeadHandler`, `defaultLeadPayload`, `verifyTurnstile`, `chatSessionId`, `createNotrackHandler`, `notrackRedirect`, `linkRedirect`, `cookieDomain`, `isPreviewHost`, `visitorFrom` |
| `@qviks/track/cookie` | `NOTRACK_COOKIE`, `HUB_URL`, `hasNotrackCookie`, `VISITOR_COOKIE`, `visitorIdFromCookie` (safe anywhere) |

## Develop

`bun test`, then `bun run build` and commit `dist/` (installed from git, no build on install).
Release: bump `version`, tag `vX.Y.Z`, push the tag, bump the `#vX.Y.Z` in each project.
