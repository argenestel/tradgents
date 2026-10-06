import { describe, expect, it } from "vitest";
import { pct, shortAddr, timeAgo, usd, MOCK_NOW } from "./format";

describe("usd", () => {
  it("formats with a real minus sign and optional plus", () => {
    expect(usd(1234.5)).toBe("$1,235");
    expect(usd(-4)).toBe("−$4.00");
    expect(usd(4, { sign: true })).toBe("+$4.00");
  });
  it("does not show a negative zero", () => {
    expect(usd(-0.001)).toBe("$0.00");
  });
});

describe("pct", () => {
  it("signs and rounds", () => {
    expect(pct(12.345, { sign: true })).toBe("+12.3%");
    expect(pct(-3.2)).toBe("−3.2%");
    expect(pct(0)).toBe("0.0%");
  });
});

describe("shortAddr", () => {
  it("shortens 0x addresses and leaves short strings alone", () => {
    expect(shortAddr("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x12…5678");
    expect(shortAddr("abc")).toBe("abc");
  });
});

describe("timeAgo", () => {
  it("is relative to the supplied clock", () => {
    expect(timeAgo(MOCK_NOW - 30_000)).toBe("just now");
    expect(timeAgo(MOCK_NOW - 5 * 60_000)).toBe("5m ago");
    expect(timeAgo(MOCK_NOW - 3 * 3_600_000)).toBe("3h ago");
    expect(timeAgo(MOCK_NOW - 2 * 86_400_000)).toBe("2d ago");
  });
});
