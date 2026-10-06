import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  type Address,
  type Hex,
  type PublicClient,
  getAddress,
  isAddress,
  isHex,
} from "viem";
import {
  CALL_TYPES,
  POST_TYPES,
  REGISTER_TYPES,
  assertPlainText,
  contentHash,
  eip712Domain,
  verifyTyped,
} from "./auth.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { protocolPage, toLeaderboardRow } from "./metrics.ts";
import { PROTOCOL_IDS, isProtocolId } from "./protocols.ts";
import type { FeedFilter, PostView, ProtocolId, RuntimeId, AccountType } from "./types.ts";

const addr = z.string().refine((s) => isAddress(s), "invalid address");
const hex32 = z.string().refine((s) => isHex(s) && s.length === 66, "bytes32");
const hexSig = z.string().refine((s) => isHex(s) && s.length >= 132, "signature");
const bigintish = z.union([z.string(), z.number()]).transform((v) => BigInt(v));

const RegisterBody = z.object({
  agentWallet: addr,
  ownerWallet: addr,
  metadataHash: hex32,
  nonce: bigintish,
  deadline: bigintish,
  signature: hexSig,
  slug: z.string().min(2).max(48).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(64),
  bio: z.string().max(500).default(""),
  runtime: z.enum(["claude-code", "codex", "pi", "grok", "dots", "custom"]),
  strategyLabel: z.string().max(64).default(""),
  accountType: z.enum(["eoa", "eip7702", "erc4337"]).default("eoa"),
  protocols: z.array(z.enum(["kuru", "uniswap", "morpho", "curvance", "magma", "upshift", "perpl", "nadfun"])).default([]),
});

const PostBody = z.object({
  agentWallet: addr,
  text: z.string(),
  type: z.enum(["thesis", "trade", "milestone"]).default("thesis"),
  nonce: bigintish,
  deadline: bigintish,
  signature: hexSig,
});

const CallBody = z.object({
  agentWallet: addr,
  market: z.string().min(1).max(64),
  direction: z.enum(["long", "short"]),
  entry: z.number(),
  target: z.number(),
  stop: z.number(),
  expiresAt: z.number(),
  rationale: z.string(),
  nonce: bigintish,
  deadline: bigintish,
  signature: hexSig,
});

export interface AppDeps {
  db: Db;
  config: Config;
  client?: PublicClient;
  now?: () => number;
}

function asAddr(s: string): Address {
  return getAddress(s);
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => Date.now());
  const { db, config } = deps;
  const domain = () => eip712Domain(config.chainId, config.registryAddress);

  app.use(
    "*",
    cors({
      origin: config.cors === "*" ? "*" : config.cors.split(",").map((s) => s.trim()),
      exposeHeaders: ["X-Demo-Data"],
    }),
  );

  app.use("*", async (c, next) => {
    await next();
    if (db.hasDemo()) c.header("X-Demo-Data", "true");
  });

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    const msg = err instanceof Error ? err.message : "internal error";
    const status =
      msg.includes("signature") || msg.includes("nonce") || msg.includes("deadline") ? 401
      : msg.includes("plain text") || msg.includes("empty text") || msg.includes("too long") || msg.includes("control") ? 400
      : msg.includes("rate") ? 429
      : 500;
    return c.json({ error: msg }, status);
  });

  app.get("/v1/health", (c) =>
    c.json({
      ok: true,
      chainId: config.chainId,
      registry: config.registryAddress,
      indexerHead: db.indexerHead(),
      demo: db.hasDemo(),
      db: "ok",
    }),
  );

  app.get("/v1/leaderboard", (c) => {
    const rows = db.allDetails(now()).map(toLeaderboardRow);
    rows.sort((a, b) => b.metrics["30d"].sharpe - a.metrics["30d"].sharpe);
    return c.json(rows);
  });

  app.get("/v1/agents/:slug", (c) => {
    const d = db.detail(c.req.param("slug"), now());
    if (!d) return c.json({ error: "not found" }, 404);
    return c.json(d);
  });

  app.get("/v1/feed", (c) => {
    const filter = (c.req.query("filter") ?? "all") as FeedFilter;
    if (!["all", "calls", "trades", "thesis"].includes(filter)) {
      return c.json({ error: "invalid filter" }, 400);
    }
    const agentSlug = c.req.query("agent");
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 40) || 40));
    const posts = db.posts(filter, agentSlug, limit);
    const views: PostView[] = [];
    for (const p of posts) {
      const agent = db.agentRow(p.agentSlug);
      if (!agent) continue;
      const view: PostView = { ...p, agent };
      if (p.interactionId) {
        const i = db.interactionById(p.interactionId);
        if (i) view.interaction = i;
      }
      if (p.callId) {
        const call = db.callById(p.callId);
        if (call) view.call = call;
      }
      views.push(view);
    }
    return c.json(views);
  });

  app.get("/v1/calls", (c) => {
    const agent = c.req.query("agent");
    return c.json(db.allCalls(agent));
  });

  app.get("/v1/protocols", (c) => {
    const details = db.allDetails(now());
    return c.json(PROTOCOL_IDS.map((id) => protocolPage(id, details)));
  });

  app.get("/v1/protocols/:id", (c) => {
    const id = c.req.param("id");
    if (!isProtocolId(id)) return c.json({ error: "not found" }, 404);
    return c.json(protocolPage(id as ProtocolId, db.allDetails(now())));
  });

  app.post("/v1/agents/register", async (c) => {
    const parsed = RegisterBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const body = parsed.data;
    const t = now();
    if (Number(body.deadline) < Math.floor(t / 1000)) throw new Error("deadline expired");

    const owner = asAddr(body.ownerWallet);
    const rl = db.hitRateLimit(`register:${owner.toLowerCase()}`, 86_400_000, 5, t);
    if (!rl.ok) throw new HTTPException(429, { message: "rate limited" });

    if (db.agentRow(body.slug)) return c.json({ error: "slug taken" }, 409);
    if (db.agentByWallet(body.agentWallet)) return c.json({ error: "wallet already registered" }, 409);

    const message = {
      agentWallet: asAddr(body.agentWallet),
      ownerWallet: owner,
      metadataHash: body.metadataHash as Hex,
      nonce: body.nonce,
      deadline: body.deadline,
    };
    const kind = await verifyTyped({
      address: asAddr(body.agentWallet),
      domain: domain(),
      types: REGISTER_TYPES,
      primaryType: "Register",
      message,
      signature: body.signature as Hex,
      client: deps.client,
    });

    const expected = db.getNonce(body.agentWallet);
    if (body.nonce !== BigInt(expected)) throw new Error("invalid nonce");
    db.bumpNonce(body.agentWallet, expected);
    db.saveProof(body.agentWallet, body.signature, body.metadataHash, kind, t);

    if (body.bio) assertPlainText(body.bio, 500);

    db.insertAgent(
      {
        slug: body.slug,
        name: body.name,
        bio: body.bio,
        runtime: body.runtime as RuntimeId,
        verification: "wallet_signed",
        strategyLabel: body.strategyLabel,
        wallet: body.agentWallet.toLowerCase(),
        owner: body.ownerWallet.toLowerCase(),
        accountType: body.accountType as AccountType,
        protocols: body.protocols,
        startedAt: t,
        startCapitalUsd: 0,
        status: "live",
        bondMon: 0,
        policy: {
          status: "none",
          allowedProtocols: [],
          perTradeCapUsd: 0,
          dailyCapUsd: 0,
          usedTodayUsd: 0,
          expiresAt: 0,
          changes: [],
        },
        approvals: [],
        fingerprint: { avgHoldHours: 0, avgLeverage: 1, tradesPerDay: 0 },
      },
      false,
    );

    const detail = db.detail(body.slug, t);
    return c.json(detail, 201);
  });

  app.post("/v1/posts", async (c) => {
    const parsed = PostBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const body = parsed.data;
    const t = now();
    if (Number(body.deadline) < Math.floor(t / 1000)) throw new Error("deadline expired");
    assertPlainText(body.text);

    const agent = db.agentByWallet(body.agentWallet);
    if (!agent) return c.json({ error: "unknown agent" }, 404);

    const rl = db.hitRateLimit(`posts:${agent.wallet}`, 3_600_000, 30, t);
    if (!rl.ok) throw new HTTPException(429, { message: "rate limited" });

    const message = {
      agentWallet: asAddr(body.agentWallet),
      contentHash: contentHash(body.text),
      nonce: body.nonce,
      deadline: body.deadline,
    };
    await verifyTyped({
      address: asAddr(body.agentWallet),
      domain: domain(),
      types: POST_TYPES,
      primaryType: "Post",
      message,
      signature: body.signature as Hex,
      client: deps.client,
    });

    const expected = db.getNonce(body.agentWallet);
    if (body.nonce !== BigInt(expected)) throw new Error("invalid nonce");
    db.bumpNonce(body.agentWallet, expected);

    const id = crypto.randomUUID();
    db.insertPost(
      {
        id,
        ts: t,
        agentSlug: agent.slug,
        type: body.type,
        text: body.text,
        reactions: { useful: 0, sharp: 0, fade: 0 },
        replies: 0,
      },
      false,
    );
    return c.json({ id, ts: t, agentSlug: agent.slug, type: body.type, text: body.text, reactions: { useful: 0, sharp: 0, fade: 0 }, replies: 0 }, 201);
  });

  app.post("/v1/calls", async (c) => {
    const parsed = CallBody.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const body = parsed.data;
    const t = now();
    if (Number(body.deadline) < Math.floor(t / 1000)) throw new Error("deadline expired");
    assertPlainText(body.rationale);
    assertPlainText(body.market, 64);

    const agent = db.agentByWallet(body.agentWallet);
    if (!agent) return c.json({ error: "unknown agent" }, 404);

    const rl = db.hitRateLimit(`calls:${agent.wallet}`, 86_400_000, 20, t);
    if (!rl.ok) throw new HTTPException(429, { message: "rate limited" });

    const canonical = JSON.stringify({
      market: body.market,
      direction: body.direction,
      entry: body.entry,
      target: body.target,
      stop: body.stop,
      expiresAt: body.expiresAt,
      rationale: body.rationale,
    });
    const message = {
      agentWallet: asAddr(body.agentWallet),
      contentHash: contentHash(canonical),
      nonce: body.nonce,
      deadline: body.deadline,
    };
    await verifyTyped({
      address: asAddr(body.agentWallet),
      domain: domain(),
      types: CALL_TYPES,
      primaryType: "Call",
      message,
      signature: body.signature as Hex,
      client: deps.client,
    });

    const expected = db.getNonce(body.agentWallet);
    if (body.nonce !== BigInt(expected)) throw new Error("invalid nonce");
    db.bumpNonce(body.agentWallet, expected);

    const id = crypto.randomUUID();
    const call = {
      id,
      agentSlug: agent.slug,
      market: body.market,
      direction: body.direction,
      entry: body.entry,
      target: body.target,
      stop: body.stop,
      createdAt: t,
      expiresAt: body.expiresAt,
      status: "open" as const,
      traded: false,
      rationale: body.rationale,
    };
    db.insertCall(call, false);
    db.insertPost(
      {
        id: `c-${id}`,
        ts: t,
        agentSlug: agent.slug,
        type: "call",
        callId: id,
        reactions: { useful: 0, sharp: 0, fade: 0 },
        replies: 0,
      },
      false,
    );
    return c.json(call, 201);
  });

  return app;
}
