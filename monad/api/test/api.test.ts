import { describe, expect, it, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { createApp } from "../src/app.ts";
import type { Config } from "../src/config.ts";
import { Db } from "../src/db.ts";
import { CALL_TYPES, POST_TYPES, REGISTER_TYPES, contentHash, eip712Domain } from "../src/auth.ts";
import { isClosing } from "../src/protocols.ts";
import type { AgentDetail, Call, LeaderboardRow, PostView, ProtocolPage } from "../src/types.ts";

const ANVIL0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const account = privateKeyToAccount(ANVIL0);
const REGISTRY = "0x0000000000000000000000000000000000000001" as const;

function cfg(): Config {
  return {
    rpcUrl: "http://127.0.0.1:1",
    registryAddress: REGISTRY,
    chainId: 31337,
    dbPath: ":memory:",
    port: 0,
    cors: "*",
    indexerPollMs: 1000,
  };
}

describe("demo API", () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = new Db(":memory:");
    db.seedDemo();
    app = createApp({ db, config: cfg() });
  });

  it("GET /v1/health sets X-Demo-Data", async () => {
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Demo-Data")).toBe("true");
    const body = (await res.json()) as { ok: boolean; demo: boolean };
    expect(body.ok).toBe(true);
    expect(body.demo).toBe(true);
  });

  it("GET /v1/leaderboard matches LeaderboardRow[]", async () => {
    const res = await app.request("/v1/leaderboard");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as LeaderboardRow[];
    expect(rows.length).toBe(10);
    for (const r of rows) {
      expect(r.agent.slug).toBeTruthy();
      expect(r.agent.wallet.startsWith("0x")).toBe(true);
      expect(r.metrics["7d"].window).toBe("7d");
      expect(r.metrics["30d"].window).toBe("30d");
      expect(r.metrics.all.window).toBe("all");
      expect(Array.isArray(r.spark)).toBe(true);
      expect(typeof r.equityUsd).toBe("number");
    }
  });

  it("GET /v1/agents/:slug returns AgentDetail and 404s unknown", async () => {
    const res = await app.request("/v1/agents/kuru-maker");
    expect(res.status).toBe(200);
    const d = (await res.json()) as AgentDetail;
    expect(d.agent.slug).toBe("kuru-maker");
    expect(d.interactions.length).toBeGreaterThan(0);
    expect(d.equity.length).toBeGreaterThan(1);
    expect(d.metrics.all.eligible).toBe(d.metrics.all.days >= 7 && d.metrics.all.trades >= 10);
    const miss = await app.request("/v1/agents/nope");
    expect(miss.status).toBe(404);
  });

  it("metrics recompute: components sum to pnl", async () => {
    const res = await app.request("/v1/agents/kuru-maker");
    const d = (await res.json()) as AgentDetail;
    for (const i of d.interactions) {
      const sum = i.components.reduce((a, c) => a + c.usd, 0);
      expect(Math.abs(sum - i.pnlUsd)).toBeLessThan(1e-9);
    }
    const realized = d.waterfall.reduce((a, w) => a + w.usd, 0);
    const net = d.equityUsd - d.agent.startCapitalUsd;
    expect(Math.abs(realized + d.unrealizedUsd - net)).toBeLessThan(1e-6);
  });

  it("GET /v1/feed filters", async () => {
    const all = (await (await app.request("/v1/feed?filter=all")).json()) as PostView[];
    const calls = (await (await app.request("/v1/feed?filter=calls")).json()) as PostView[];
    const trades = (await (await app.request("/v1/feed?filter=trades")).json()) as PostView[];
    const thesis = (await (await app.request("/v1/feed?filter=thesis")).json()) as PostView[];
    expect(all.length).toBeGreaterThan(0);
    expect(calls.every((p) => p.type === "call")).toBe(true);
    expect(trades.every((p) => p.type === "trade")).toBe(true);
    expect(thesis.every((p) => p.type === "thesis")).toBe(true);
    expect(all[0].agent.slug).toBeTruthy();
  });

  it("GET /v1/calls and protocols", async () => {
    const calls = (await (await app.request("/v1/calls")).json()) as Call[];
    expect(calls.length).toBeGreaterThan(0);
    expect(["open", "hit", "stopped", "expired"]).toContain(calls[0].status);
    const pages = (await (await app.request("/v1/protocols")).json()) as ProtocolPage[];
    expect(pages.length).toBe(8);
    const kuru = (await (await app.request("/v1/protocols/kuru")).json()) as ProtocolPage;
    expect(kuru.protocol).toBe("kuru");
    expect(kuru.totalTrades).toBeGreaterThan(0);
    const miss = await app.request("/v1/protocols/not-a-protocol");
    expect(miss.status).toBe(404);
  });

  it("only closing interactions count toward win rate", async () => {
    const d = (await (await app.request("/v1/agents/perpl-scalper")).json()) as AgentDetail;
    const open = d.interactions.find((i) => i.kind === "perp_open");
    expect(open && isClosing(open)).toBe(false);
  });
});

describe("signed writes", () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  const config = cfg();
  const domain = eip712Domain(config.chainId, config.registryAddress);

  beforeEach(() => {
    db = new Db(":memory:");
    app = createApp({ db, config });
  });

  async function register() {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
    const metadataHash = contentHash("meta");
    const message = {
      agentWallet: account.address,
      ownerWallet: account.address,
      metadataHash,
      nonce: 0n,
      deadline,
    };
    const signature = await account.signTypedData({ domain, types: REGISTER_TYPES, primaryType: "Register", message });
    const res = await app.request("/v1/agents/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentWallet: account.address,
        ownerWallet: account.address,
        metadataHash,
        nonce: "0",
        deadline: deadline.toString(),
        signature,
        slug: "real-bot",
        name: "RealBot",
        bio: "plain bio",
        runtime: "custom",
        strategyLabel: "spot",
        accountType: "eoa",
        protocols: ["kuru"],
      }),
    });
    return res;
  }

  it("POST /v1/agents/register EIP-712 happy path; real agent has no trades", async () => {
    const res = await register();
    expect(res.status).toBe(201);
    const d = (await res.json()) as AgentDetail;
    expect(d.agent.slug).toBe("real-bot");
    expect(d.agent.verification).toBe("wallet_signed");
    expect(d.interactions).toEqual([]);
    expect(d.metrics.all.trades).toBe(0);
    expect(d.metrics.all.eligible).toBe(false);
  });

  it("rejects bad signature and replay", async () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
    const metadataHash = contentHash("meta");
    const message = {
      agentWallet: account.address,
      ownerWallet: account.address,
      metadataHash,
      nonce: 0n,
      deadline,
    };
    const other = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const bad = await other.signTypedData({ domain, types: REGISTER_TYPES, primaryType: "Register", message });
    const res = await app.request("/v1/agents/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentWallet: account.address,
        ownerWallet: account.address,
        metadataHash,
        nonce: "0",
        deadline: deadline.toString(),
        signature: bad,
        slug: "badsig",
        name: "X",
        runtime: "custom",
      }),
    });
    expect(res.status).toBe(401);

    const ok = await register();
    expect(ok.status).toBe(201);
    const replay = await register();
    expect(replay.status).toBe(409);
  });

  it("POST /v1/posts plain text only, authenticated", async () => {
    expect((await register()).status).toBe(201);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
    const text = "Spreads are wide. Sizing down.";
    const message = {
      agentWallet: account.address,
      contentHash: contentHash(text),
      nonce: BigInt(db.getNonce(account.address)),
      deadline,
    };
    const signature = await account.signTypedData({ domain, types: POST_TYPES, primaryType: "Post", message });
    const res = await app.request("/v1/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentWallet: account.address,
        text,
        type: "thesis",
        nonce: message.nonce.toString(),
        deadline: deadline.toString(),
        signature,
      }),
    });
    expect(res.status).toBe(201);
    const post = (await res.json()) as { text: string; type: string };
    expect(post.text).toBe(text);
    expect(post.type).toBe("thesis");

    const html = await app.request("/v1/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentWallet: account.address,
        text: "<script>alert(1)</script>",
        nonce: "1",
        deadline: deadline.toString(),
        signature,
      }),
    });
    expect(html.status).toBe(400);
  });

  it("POST /v1/calls", async () => {
    expect((await register()).status).toBe(201);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
    const payload = {
      market: "MON-PERP",
      direction: "long" as const,
      entry: 0.04,
      target: 0.05,
      stop: 0.03,
      expiresAt: Date.now() + 86400000,
      rationale: "Momentum plus supportive funding; invalidates below the stop.",
    };
    const canonical = JSON.stringify(payload);
    const nonce = BigInt(db.getNonce(account.address));
    const message = { agentWallet: account.address, contentHash: contentHash(canonical), nonce, deadline };
    const signature = await account.signTypedData({ domain, types: CALL_TYPES, primaryType: "Call", message });
    const res = await app.request("/v1/calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentWallet: account.address,
        ...payload,
        nonce: nonce.toString(),
        deadline: deadline.toString(),
        signature,
      }),
    });
    expect(res.status).toBe(201);
    const call = (await res.json()) as Call;
    expect(call.market).toBe("MON-PERP");
    expect(call.status).toBe("open");
    expect(call.rationale).toBe(payload.rationale);
  });

  it("rate-limits posts", async () => {
    expect((await register()).status).toBe(201);
    const t0 = Date.now();
    for (let i = 0; i < 30; i++) db.hitRateLimit(`posts:${account.address.toLowerCase()}`, 3_600_000, 30, t0);
    const extra = db.hitRateLimit(`posts:${account.address.toLowerCase()}`, 3_600_000, 30, t0);
    expect(extra.ok).toBe(false);
  });
});
