# qviks-track

Package `@qviks/track`: visit + click tracking and contact forms (`useLeadForm` + `createLeadHandler`) for our Next.js sites, stored in Qviks.
README.md is the full spec (behaviour, install, exports); read it first.

- Source: `src/client.tsx` (browser), `src/server.ts` (route handlers, redirects), `src/cookie.ts`.
  Tests: `src/server.test.ts`. Build: `bun run build` (output in `dist/`, committed).
- Consumers install it from GitHub by tag (`github:meacoolash/qviks-track#vX.Y.Z`):
  `../sites`, `../mikistec`, `../qviks`, `../project-resume` (Next 14), `../domskolak` (npm). joymeseci.com runs on `sites`: never ship a breaking change.
- Release: bump version, build, commit, tag `vX.Y.Z`, push tag, then bump the tag in each consumer.
- The browser only calls its own `/api/track`; the server relays to Qviks API v1 with the org key.
  No keys in this repo. Server side lives in `../qviks` (`/api/v1/track`, `src/lib/notrack.ts`).
