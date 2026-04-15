import { describe, it, expect } from "vitest";
import {
  recallAtK,
  reciprocalRank,
  ndcgAtK,
  hitAtOne,
  aggregate,
} from "../../eval/metrics.js";

describe("recallAtK", () => {
  it("returns 0 when no relevant docs defined", () => {
    expect(recallAtK(["a", "b"], new Set(), 10)).toBe(0);
  });
  it("returns hits / |relevant|", () => {
    expect(recallAtK(["a", "rel1", "b", "rel2"], new Set(["rel1", "rel2", "rel3"]), 10)).toBeCloseTo(2 / 3);
  });
  it("honors K truncation", () => {
    expect(recallAtK(["a", "b", "rel1"], new Set(["rel1"]), 2)).toBe(0);
    expect(recallAtK(["a", "b", "rel1"], new Set(["rel1"]), 3)).toBe(1);
  });
  it("returns 1.0 when every relevant appears in top-K", () => {
    expect(recallAtK(["rel1", "rel2"], new Set(["rel1", "rel2"]), 10)).toBe(1);
  });
});

describe("reciprocalRank", () => {
  it("is 1 when first result is relevant", () => {
    expect(reciprocalRank(["rel1", "a"], new Set(["rel1"]))).toBe(1);
  });
  it("is 1/n when first relevant is at rank n", () => {
    expect(reciprocalRank(["a", "b", "c", "rel1"], new Set(["rel1"]))).toBeCloseTo(0.25);
  });
  it("is 0 when no relevant found", () => {
    expect(reciprocalRank(["a", "b"], new Set(["rel1"]))).toBe(0);
  });
  it("only counts the first relevant hit, not subsequent ones", () => {
    expect(reciprocalRank(["a", "rel1", "rel2"], new Set(["rel1", "rel2"]))).toBeCloseTo(0.5);
  });
});

describe("ndcgAtK", () => {
  it("is 1.0 for a perfect ranking", () => {
    expect(ndcgAtK(["rel1", "rel2"], new Set(["rel1", "rel2"]), 10)).toBeCloseTo(1);
  });
  it("is 0 when no relevant in top-K", () => {
    expect(ndcgAtK(["a", "b"], new Set(["rel1"]), 10)).toBe(0);
  });
  it("matches hand computation for a mixed ranking", () => {
    // retrieved = [A,B,X,Y,rel1,Z,rel2,M,N,O], relevant = {rel1,rel2,rel3}, K=10
    // DCG = 1/log2(6) + 1/log2(8) = 0.38685 + 0.33333 = 0.72019
    // IDCG (3 relevant, all at top) = 1 + 1/log2(3) + 1/log2(4) = 2.1309
    // NDCG = 0.72019 / 2.1309 = 0.33798
    const got = ndcgAtK(
      ["A", "B", "X", "Y", "rel1", "Z", "rel2", "M", "N", "O"],
      new Set(["rel1", "rel2", "rel3"]),
      10,
    );
    expect(got).toBeCloseTo(0.33798, 3);
  });
});

describe("hitAtOne", () => {
  it("is 1 when rank 1 is relevant", () => {
    expect(hitAtOne(["rel1", "a"], new Set(["rel1"]))).toBe(1);
  });
  it("is 0 when rank 1 is not relevant", () => {
    expect(hitAtOne(["a", "rel1"], new Set(["rel1"]))).toBe(0);
  });
  it("is 0 for empty retrieved", () => {
    expect(hitAtOne([], new Set(["rel1"]))).toBe(0);
  });
});

describe("aggregate", () => {
  it("returns zeros for empty input", () => {
    expect(aggregate([])).toEqual({ recallAtK: 0, mrr: 0, ndcgAtK: 0, hitAtOne: 0 });
  });
  it("computes arithmetic mean over queries", () => {
    const out = aggregate([
      { recallAtK: 1, mrr: 1, ndcgAtK: 1, hitAtOne: 1 },
      { recallAtK: 0, mrr: 0, ndcgAtK: 0, hitAtOne: 0 },
    ]);
    expect(out.recallAtK).toBeCloseTo(0.5);
    expect(out.mrr).toBeCloseTo(0.5);
    expect(out.ndcgAtK).toBeCloseTo(0.5);
    expect(out.hitAtOne).toBeCloseTo(0.5);
  });
});
