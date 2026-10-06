import { describe, expect, it } from "vitest";
import { DB } from "./seed";
import { isClosing } from "../protocols";

describe("demo dataset invariants", () => {
  it("every component list sums to the interaction's realized PnL", () => {
    for (const d of DB.agents.values()) {
      for (const i of d.interactions) {
        const sum = i.components.reduce((a, c) => a + c.usd, 0);
        expect(Math.abs(sum - i.pnlUsd)).toBeLessThan(1e-9);
      }
    }
  });

  it("waterfall + unrealized equals net equity change", () => {
    for (const d of DB.agents.values()) {
      const realized = d.waterfall.reduce((a, w) => a + w.usd, 0);
      const net = d.equityUsd - d.agent.startCapitalUsd;
      expect(Math.abs(realized + d.unrealizedUsd - net)).toBeLessThan(1e-6);
    }
  });

  it("per-protocol PnL sums to total realized PnL", () => {
    for (const d of DB.agents.values()) {
      const byP = d.byProtocol.reduce((a, s) => a + s.pnlUsd, 0);
      const total = d.interactions.reduce((a, i) => a + i.pnlUsd, 0);
      expect(Math.abs(byP - total)).toBeLessThan(1e-6);
    }
  });

  it("eligibility requires >=7 days and >=10 trades", () => {
    for (const d of DB.agents.values()) {
      for (const m of Object.values(d.metrics)) {
        expect(m.eligible).toBe(m.days >= 7 && m.trades >= 10);
      }
    }
  });

  it("the Sharpe confidence interval brackets the point estimate", () => {
    for (const d of DB.agents.values()) {
      const m = d.metrics.all;
      if (m.days > 1) {
        expect(m.sharpeLo).toBeLessThanOrEqual(m.sharpe);
        expect(m.sharpeHi).toBeGreaterThanOrEqual(m.sharpe);
      }
    }
  });

  it("includes a young agent that is correctly not ranked, and an agent with no spend policy", () => {
    const young = [...DB.agents.values()].filter((d) => !d.metrics.all.eligible);
    expect(young.length).toBeGreaterThan(0);
    expect([...DB.agents.values()].some((d) => d.agent.policy.status === "none")).toBe(true);
  });

  it("block numbers increase with time", () => {
    const d = [...DB.agents.values()][0];
    const sorted = [...d.interactions].sort((a, b) => a.ts - b.ts);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k].blockNumber).toBeGreaterThanOrEqual(sorted[k - 1].blockNumber);
  });

  it("only closing interactions count toward win rate", () => {
    const perp = [...DB.agents.values()].flatMap((d) => d.interactions).find((i) => i.kind === "perp_open");
    expect(perp && isClosing(perp)).toBe(false);
  });
});
