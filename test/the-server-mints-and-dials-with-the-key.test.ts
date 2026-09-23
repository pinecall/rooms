// The tenant's server holds the key: it mints a seat's ticket and places a call, and a refusal keeps the gateway's sentence.

import { describe, expect, it } from "vitest";

import { dial, GatewayRefused, mint } from "../src/server/index.js";

const KEY = "pk_test_not_a_real_key";

interface Posted {
  url: string;
  method: string | undefined;
  authorization: string | null;
  body: unknown;
  timed: boolean;
}

/** A gateway that answers every request with `status` and `body`, and writes each one down. */
function gateway(status: number, body: string): { fetch: typeof fetch; posted: Posted[] } {
  const posted: Posted[] = [];
  return {
    posted,
    fetch: async (input, init) => {
      posted.push({
        url: String(input),
        method: init?.method,
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        timed: init?.signal instanceof AbortSignal,
      });
      return new Response(body, { status });
    },
  };
}

const MINTED = { server_url: "wss://lk.example", participant_token: "ticket", call: "call_1" };
const DIALED = { call: "call_2", agent: "clinica", to: "+34600000001", from: "+34910000000", env: "production" };

describe("the server", () => {
  it("mints with the key: {agent, scope, ttl_s} to /v1/tokens, the bearer on the header", async () => {
    const { fetch, posted } = gateway(200, JSON.stringify(MINTED));
    const minted = await mint(KEY, { url: "https://gw.example/", agent: "clinica", scope: "talk", ttl_s: 120, fetch });

    expect(minted).toEqual(MINTED);
    expect(posted).toEqual([
      {
        url: "https://gw.example/v1/tokens",
        method: "POST",
        authorization: `Bearer ${KEY}`,
        body: { agent: "clinica", scope: "talk", ttl_s: 120 },
        timed: true,
      },
    ]);
  });

  it("dials with the key: {to, from} to /v1/agents/{agent}/dial", async () => {
    const { fetch, posted } = gateway(202, JSON.stringify(DIALED));
    const dialed = await dial(KEY, { url: "https://gw.example", agent: "clinica", to: "+34600000001", fetch });

    expect(dialed).toEqual(DIALED);
    expect(posted[0]?.url).toBe("https://gw.example/v1/agents/clinica/dial");
    expect(posted[0]?.body).toEqual({ to: "+34600000001" });
    expect(posted[0]?.authorization).toBe(`Bearer ${KEY}`);
  });

  it("throws GatewayRefused with the gateway's own sentence", async () => {
    const { fetch } = gateway(429, JSON.stringify({ detail: "more dials this minute than the org's per_minute" }));
    const refused = dial(KEY, { url: "https://gw.example", agent: "clinica", to: "+34600000001", fetch });

    await expect(refused).rejects.toBeInstanceOf(GatewayRefused);
    await expect(refused).rejects.toMatchObject({
      status: 429,
      detail: "more dials this minute than the org's per_minute",
      message: "more dials this minute than the org's per_minute",
    });
  });

  it("throws the status alone when the body is not the gateway's JSON", async () => {
    const { fetch } = gateway(502, "<html>bad gateway</html>");
    const refused = mint(KEY, { url: "https://gw.example", agent: "clinica", scope: "chat", fetch });

    await expect(refused).rejects.toMatchObject({ status: 502, detail: null, message: "the gateway answered 502" });
  });
});
