import { afterEach, describe, expect, it, mock } from "bun:test";
import { cookieDomain, createLeadHandler, createNotrackHandler, createTrackHandler, linkRedirect, notrackRedirect, visitorFrom } from "./server";
import { hasNotrackCookie, visitorIdFromCookie } from "./cookie";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const get = (url: string, host = new URL(url).host) => new Request(url, { headers: { host } });

describe("cookie", () => {
  it("reads the opt-out cookie", () => {
    expect(hasNotrackCookie("a=1; qviks_no_track=1")).toBe(true);
    expect(hasNotrackCookie("qviks_no_track=10")).toBe(false);
    expect(hasNotrackCookie(null)).toBe(false);
  });
  it("cookieDomain: qviks.com for its subdomains, else minus www", () => {
    expect(cookieDomain("sites.qviks.com")).toBe("qviks.com");
    expect(cookieDomain("www.mikistec.com")).toBe("mikistec.com");
    expect(cookieDomain("joymeseci.com:443")).toBe("joymeseci.com");
  });
});

describe("createNotrackHandler", () => {
  const GET = createNotrackHandler();

  it("sets the cookie for this domain and follows an allowed next", () => {
    const res = GET(get("https://www.mikistec.com/api/notrack?v=1&next=" + encodeURIComponent("https://sites.qviks.com/api/notrack?v=1")));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://sites.qviks.com/api/notrack?v=1");
    expect(res.headers.get("set-cookie")).toContain("qviks_no_track=1; Path=/; Max-Age=31536000; Domain=mikistec.com");
  });

  it("clears with v=0 and follows a relative next", () => {
    const res = GET(get("https://mikistec.com/api/notrack?v=0&next=%2Fsk%2Fpricing"));
    expect(res.headers.get("location")).toBe("https://mikistec.com/sk/pricing");
    expect(res.headers.get("set-cookie")).toContain("qviks_no_track=; Path=/; Max-Age=0; Domain=mikistec.com");
  });

  it("never redirects to a foreign host", () => {
    for (const next of ["https://evil.com/", "//evil.com/", "http://www.qviks.com/x"]) {
      const res = GET(get("https://mikistec.com/api/notrack?v=1&next=" + encodeURIComponent(next)));
      expect(res.headers.get("location")).toBe("https://www.qviks.com/notrack");
    }
  });

  it("chains through other origins with chain=1, skipping its own", () => {
    const sites = createNotrackHandler({
      chainOrigins: () => ["https://sites.qviks.com", "https://joymeseci.com", "https://akademiaduse.sk"],
      allowHost: (h) => ["joymeseci.com", "akademiaduse.sk", "mikistec.com"].includes(h.replace(/^www\./, "")),
    });
    const res = sites(get("https://sites.qviks.com/api/notrack?v=1&chain=1&next=" + encodeURIComponent("https://mikistec.com/x")));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe("joymeseci.com");
    const second = new URL(loc.searchParams.get("next")!);
    expect(second.host).toBe("akademiaduse.sk");
    expect(second.searchParams.get("next")).toBe("https://mikistec.com/x");
    expect(res.headers.get("set-cookie")).toContain("Domain=qviks.com");
  });

  it("preview host: host-only cookie, no chain", () => {
    const res = createNotrackHandler({ chainOrigins: () => ["https://joymeseci.com"] })(
      get("http://localhost:3000/api/notrack?v=1&chain=1&next=%2Fx")
    );
    expect(res.headers.get("location")).toBe("http://localhost:3000/x");
    expect(res.headers.get("set-cookie")).not.toContain("Domain");
  });
});

describe("notrackRedirect", () => {
  it("sends ?notrack to the switch on Qviks and drops the param", () => {
    const res = notrackRedirect(get("https://mikistec.com/sk/pricing?notrack=1&x=2"))!;
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://www.qviks.com/api/notrack");
    expect(loc.searchParams.get("v")).toBe("1");
    expect(loc.searchParams.get("next")).toBe("https://mikistec.com/sk/pricing?x=2");
  });
  it("preview: own endpoint", () => {
    const res = notrackRedirect(get("http://localhost:3000/a?notrack=0"))!;
    expect(res.headers.get("location")).toBe("http://localhost:3000/api/notrack?v=0&next=%2Fa");
  });
  it("/notrack -> switch page, except on the switch's own host", () => {
    expect(notrackRedirect(get("https://mikistec.com/notrack"))!.headers.get("location")).toBe("https://www.qviks.com/notrack");
    expect(notrackRedirect(get("https://www.qviks.com/notrack"))).toBeNull();
    expect(notrackRedirect(get("https://mikistec.com/pricing"))).toBeNull();
  });
});

describe("createTrackHandler", () => {
  const beacon = (headers: Record<string, string>, body: unknown = { event: "pageview", site: "x", path: "/" }) =>
    new Request("https://mikistec.com/api/track", {
      method: "POST",
      headers: { host: "mikistec.com", origin: "https://mikistec.com", "user-agent": "UA", "x-forwarded-for": "1.2.3.4", ...headers },
      body: JSON.stringify(body),
    });

  it("forwards to Qviks with the key and visitor headers", async () => {
    const calls: [string, RequestInit][] = [];
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const POST = createTrackHandler({ key: "k1", apiUrl: "https://q.example/" });
    const res = await POST(beacon({}));
    expect(await res.json()).toEqual({ ok: true });
    expect(calls[0][0]).toBe("https://q.example/api/v1/track");
    const h = calls[0][1].headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer k1");
    expect(h["x-qviks-visitor-ip"]).toBe("1.2.3.4");
    expect(h["x-qviks-visitor-host"]).toBe("mikistec.com");
  });

  it("drops opted-out, foreign-origin and keyless beacons without calling Qviks", async () => {
    const f = mock(async () => new Response("{}"));
    globalThis.fetch = f as unknown as typeof fetch;
    const POST = createTrackHandler({ key: "k1", apiUrl: "https://q.example" });
    expect((await (await POST(beacon({ cookie: "qviks_no_track=1" }))).json()).skipped).toBe("opted-out");
    expect((await (await POST(beacon({ origin: "https://evil.com" }))).json()).skipped).toBe("foreign-origin");
    const keyless = createTrackHandler({ key: () => null, apiUrl: "https://q.example" });
    expect((await (await keyless(beacon({}))).json()).skipped).toBe("no-key");
    expect(f).not.toHaveBeenCalled();
  });

  it("skips localhost and rejects bad bodies", async () => {
    const POST = createTrackHandler({ key: "k1", apiUrl: "https://q.example" });
    expect((await (await POST(beacon({ host: "localhost:3000", origin: "http://localhost:3000" }))).json()).skipped).toBe("localhost");
    expect((await POST(beacon({}, [1]))).status).toBe(400);
  });
});

describe("linkRedirect", () => {
  const loc = (url: string) => linkRedirect(get(url))?.headers.get("location") ?? null;
  it("/q/<code> -> home with utm", () => {
    const res = linkRedirect(get("https://nickdemetry.com/q/Plagat1"))!;
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://nickdemetry.com/?utm_source=q&utm_campaign=plagat1");
  });
  it("keeps a target path and existing params", () => {
    expect(loc("https://joymeseci.com/q/jana/return-to-roots?x=1")).toBe("https://joymeseci.com/return-to-roots?x=1&utm_source=q&utm_campaign=jana");
  });
  it("path prefix (shared host)", () => {
    expect(loc("https://sites.qviks.com/demo/hightenso/q/ig")).toBe("https://sites.qviks.com/demo/hightenso?utm_source=q&utm_campaign=ig");
  });
  it("ignores other paths", () => {
    expect(loc("https://mikistec.com/q")).toBeNull();
    expect(loc("https://mikistec.com/faq/")).toBeNull();
    expect(loc("https://mikistec.com/api/q/x")).toBeNull();
    expect(loc("https://mikistec.com/q/bad.code")).toBeNull();
  });
});

describe("visitor id cookie", () => {
  it("is read from the Cookie header and forwarded", () => {
    expect(visitorIdFromCookie("a=1; qviks_vid=3f2a9c1e-0000-4000-8000-123456789abc; b=2")).toBe("3f2a9c1e-0000-4000-8000-123456789abc");
    expect(visitorIdFromCookie("qviks_vid=<script>")).toBeNull();
    const req = new Request("https://x.com/api/lead", { headers: { cookie: "qviks_vid=abcdef123456" } });
    expect(visitorFrom(req).id).toBe("abcdef123456");
  });
});

describe("createLeadHandler", () => {
  const post = (body: unknown, origin = "https://domskolak.sk") =>
    new Request("https://domskolak.sk/api/lead", {
      method: "POST",
      headers: { host: "domskolak.sk", origin, "content-type": "application/json", cookie: "qviks_vid=abcdef12-3456", "x-forwarded-for": "1.2.3.4" },
      body: JSON.stringify(body),
    });
  const POST = createLeadHandler({
    key: "k1",
    apiUrl: "https://q.test/",
    forms: { default: { topic: "domskolak.sk", tags: ["Web"], source: "lead_form", extras: { child: "Vek dieťaťa" } } },
  });

  it("relays to Qviks with key, visitor headers and folded extras", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json({ ok: true, saved: true }, { status: 201 });
    }) as unknown as typeof fetch;
    const res = await POST(post({ name: "Jana", email: "j@x.sk", message: "Ahoj", child: "5", topic: "spoofed", tags: ["x"] }));
    expect(res.status).toBe(201);
    expect(seen!.url).toBe("https://q.test/api/v1/leads");
    const h = seen!.init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer k1");
    expect(h["x-qviks-visitor-id"]).toBe("abcdef12-3456");
    expect(h["x-qviks-visitor-ip"]).toBe("1.2.3.4");
    expect(JSON.parse(String(seen!.init.body))).toEqual({
      name: "Jana",
      email: "j@x.sk",
      message: "Vek dieťaťa: 5\n---\nAhoj",
      source: "lead_form",
      topic: "domskolak.sk",
      tags: ["Web"],
    });
  });

  it("silently acks a foreign origin and a filled honeypot without calling Qviks", async () => {
    const f = mock(async () => Response.json({}));
    globalThis.fetch = f as unknown as typeof fetch;
    expect((await POST(post({ name: "a", email: "a@b.cz" }, "https://evil.test"))).status).toBe(201);
    expect((await POST(post({ name: "a", email: "a@b.cz", hp_url: "http://spam" }))).status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });

  it("does not tie the lead to visits when tracking is off", async () => {
    let h: Record<string, string> = {};
    globalThis.fetch = mock(async (_u: string, init: RequestInit) => {
      h = init.headers as Record<string, string>;
      return Response.json({ ok: true }, { status: 201 });
    }) as unknown as typeof fetch;
    const req = new Request("https://domskolak.sk/api/lead", {
      method: "POST",
      headers: { host: "domskolak.sk", origin: "https://domskolak.sk", cookie: "qviks_vid=abcdef12-3456; qviks_no_track=1" },
      body: JSON.stringify({ name: "a", email: "a@b.cz" }),
    });
    expect((await POST(req)).status).toBe(201);
    expect(h["x-qviks-visitor-id"]).toBeUndefined();
  });

  it("rejects an unknown form and passes Qviks errors through", async () => {
    expect((await POST(post({ form: "nope", name: "a", email: "a@b.cz" }))).status).toBe(400);
    globalThis.fetch = mock(async () => Response.json({ error: "Name and a valid email are required." }, { status: 400 })) as unknown as typeof fetch;
    const res = await POST(post({ name: "", email: "x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Name and a valid email are required." });
  });

  it("502 when Qviks is unreachable or not configured", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect((await POST(post({ name: "a", email: "a@b.cz" }))).status).toBe(502);
    const noKey = createLeadHandler({ key: undefined, apiUrl: "https://q.test" });
    expect((await noKey(post({ name: "a", email: "a@b.cz" }))).status).toBe(502);
  });
});
