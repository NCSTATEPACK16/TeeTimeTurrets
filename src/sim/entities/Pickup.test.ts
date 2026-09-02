import { describe, expect, it } from "vitest";
import { BUCKET_COOLDOWN_S, createBucket, stepBucket, tryTakeBucket } from "./Pickup";

describe("Bucket pickup", () => {
  it("grants a take within range when off cooldown, and starts the cooldown", () => {
    const bucket = createBucket(0, 0);
    expect(tryTakeBucket(bucket, 1, 0, 3)).toBe(true);
    expect(bucket.cooldownRemaining).toBe(BUCKET_COOLDOWN_S);
  });

  it("does nothing outside range", () => {
    const bucket = createBucket(0, 0);
    expect(tryTakeBucket(bucket, 10, 0, 3)).toBe(false);
    expect(bucket.cooldownRemaining).toBe(0);
  });

  it("is unavailable immediately after being taken, even in range", () => {
    const bucket = createBucket(0, 0);
    tryTakeBucket(bucket, 0, 0, 3);
    expect(tryTakeBucket(bucket, 0, 0, 3)).toBe(false);
  });

  it("becomes available again only after BUCKET_COOLDOWN_S of stepBucket", () => {
    const bucket = createBucket(0, 0);
    tryTakeBucket(bucket, 0, 0, 3);

    for (let i = 0; i < BUCKET_COOLDOWN_S - 1; i++) stepBucket(bucket, 1);
    expect(tryTakeBucket(bucket, 0, 0, 3)).toBe(false);

    stepBucket(bucket, 1);
    expect(bucket.cooldownRemaining).toBe(0);
    expect(tryTakeBucket(bucket, 0, 0, 3)).toBe(true);
  });

  it("stepBucket never drives cooldownRemaining negative", () => {
    const bucket = createBucket(0, 0);
    stepBucket(bucket, 1);
    expect(bucket.cooldownRemaining).toBe(0);
  });
});
