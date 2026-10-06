import { describe, expect, it } from "vitest";
import { adapt } from "./api";

describe("adapt", () => {
  it("maps EVM field names onto the shared vocabulary anywhere in a response", () => {
    const out = adapt([{ agent: { bondMon: 2 }, interaction: { txHash: "0xabc", signature: undefined } }]) as { agent: { bondSol: number }; interaction: { signature: string } }[];
    expect(out[0].agent.bondSol).toBe(2);
    expect(out[0].interaction.signature).toBe("0xabc");
  });
  it("leaves existing shared fields alone", () => {
    expect(adapt({ signature: "s", txHash: "t", bondSol: 1, bondMon: 9 })).toMatchObject({ signature: "s", bondSol: 1 });
  });
});
