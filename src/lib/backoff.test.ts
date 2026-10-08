import { describe, expect, it } from "vitest";
import { backoffDelay, NATIVE_AD_BACKOFF } from "./backoff";

const noJitter = () => 0.5; // random()*2-1 === 0

describe("native ad exponential backoff", () => {
  it("starts at 5 seconds and doubles each retry", () => {
    expect(backoffDelay(0, NATIVE_AD_BACKOFF, noJitter)).toBe(5_000);
    expect(backoffDelay(1, NATIVE_AD_BACKOFF, noJitter)).toBe(10_000);
    expect(backoffDelay(2, NATIVE_AD_BACKOFF, noJitter)).toBe(20_000);
  });

  it("never waits longer than 5 minutes", () => {
    expect(backoffDelay(20, NATIVE_AD_BACKOFF, noJitter)).toBe(300_000);
    expect(backoffDelay(20, NATIVE_AD_BACKOFF, () => 1)).toBe(300_000);
  });

  it("spreads delays by at most 20 percent", () => {
    expect(backoffDelay(1, NATIVE_AD_BACKOFF, () => 0)).toBe(8_000);
    expect(backoffDelay(1, NATIVE_AD_BACKOFF, () => 1)).toBe(12_000);
  });
});
