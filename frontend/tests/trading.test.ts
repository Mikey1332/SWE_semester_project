import { expect, test } from "vitest";
import { artworkColor, entryLabels, entryResult, held, lastMove, marketQuestion, sideLabel, matchesFilter, monogram, parseQuantity, rankPath, sidePrice, sortMarkets, type Account, type LedgerEntry, type LiveMarket } from "../app/trading";

const market: LiveMarket = {
    id: 7, title: "Golden", artist: "HUNTR/X", chart_date: "2026-10-31", baseline_rank: 12,
    shift: 5, yes_price: 62, no_price: 38, closes_at: "2026-10-26T04:00:00Z", volume: 40,
    history: [{ chart_date: "2026-10-17", rank: 17 }, { chart_date: "2026-10-24", rank: 12 }],
};

test("direction questions and labels", () => {
    expect(marketQuestion(market)).toBe("Will Golden go up or down from #12 on October 31, 2026?");
    expect(marketQuestion({ ...market, baseline_rank: 1 })).toBe("Will Golden stay at #1 or go down on October 31, 2026?");
    expect(sideLabel(1, "yes")).toBe("STAY");
    expect(sideLabel(3, "yes")).toBe("UP");
    expect(sideLabel(3, "no")).toBe("DOWN");
});

test("price and holdings per side", () => {
    const account: Account = { balance: 9380, realized_pnl: 0, positions: [{ market_id: 7, side: "yes", quantity: 10, cost_basis: 620 }] };
    expect(sidePrice(market, "yes")).toBe(62);
    expect(sidePrice(market, "no")).toBe(38);
    expect(held(account, 7, "yes")).toBe(10);
    expect(held(account, 7, "no")).toBe(0);
    expect(held(null, 7, "yes")).toBe(0);
});

test("quantity must be a whole number the backend accepts", () => {
    expect(parseQuantity("10")).toBe(10);
    for (const bad of ["", "0", "-1", "2.5", "abc", "1000001"]) expect(parseQuantity(bad)).toBeNull();
});

test("ledger entries show how their contracts turned out", () => {
    const base: LedgerEntry = {
        id: 1, created_at: "2026-10-22T12:00:00Z", kind: "buy", amount: -620, balance_after: 9380,
        side: "yes", quantity: 10, price: 62, market_id: 7, title: "Golden", artist: "HUNTR/X",
        chart_date: "2026-10-31", baseline_rank: 12, shift: 5, market_status: "open", outcome: null,
    };
    expect(entryResult(base)).toBe("Open");
    expect(entryResult({ ...base, market_status: "resolved", outcome: "yes" })).toBe("Won");
    expect(entryResult({ ...base, market_status: "resolved", outcome: "no" })).toBe("Lost");
    expect(entryResult({ ...base, kind: "grant", side: null, market_id: null, market_status: null })).toBe("");
    expect(entryLabels.sell).toBe("Sold");
    expect(entryResult({ ...base, kind: "sell", market_status: "resolved", outcome: "refund" })).toBe("");
    expect(entryResult({ ...base, kind: "buy", market_status: "resolved", outcome: "refund" })).toBe("");
    expect(entryResult({ ...base, kind: "refund", market_status: "resolved", outcome: "refund" })).toBe("Refunded");
});

test("cards show the artist's initials in a stable color", () => {
    expect(monogram("Taylor Swift")).toBe("TS");
    expect(monogram("HUNTR/X")).toBe("HX");
    expect(monogram("Doechii")).toBe("D");
    expect(artworkColor(7)).toBe(artworkColor(13));
    expect(artworkColor(7)).not.toBe(artworkColor(8));
});

test("last week's move drives the Rising, Falling and New entries filters", () => {
    const falling: LiveMarket = { ...market, id: 8, history: [{ chart_date: "2026-10-17", rank: 3 }, { chart_date: "2026-10-24", rank: 9 }] };
    const debut: LiveMarket = { ...market, id: 9, history: [{ chart_date: "2026-10-24", rank: 40 }] };
    expect(lastMove(market)).toBe(5);
    expect(lastMove(falling)).toBe(-6);
    expect(lastMove(debut)).toBeNull();
    expect([market, falling, debut].filter(m => matchesFilter(m, "Rising")).map(m => m.id)).toEqual([7]);
    expect([market, falling, debut].filter(m => matchesFilter(m, "Falling")).map(m => m.id)).toEqual([8]);
    expect([market, falling, debut].filter(m => matchesFilter(m, "New entries")).map(m => m.id)).toEqual([9]);
});

test("sorting by chart rank, chance and activity", () => {
    const a: LiveMarket = { ...market, id: 1, baseline_rank: 30, yes_price: 80, volume: 5 };
    const b: LiveMarket = { ...market, id: 2, baseline_rank: 2, yes_price: 20, volume: 90 };
    expect(sortMarkets([a, b], "Chart rank").map(m => m.id)).toEqual([2, 1]);
    expect(sortMarkets([b, a], "Highest chance").map(m => m.id)).toEqual([1, 2]);
    expect(sortMarkets([a, b], "Most active").map(m => m.id)).toEqual([2, 1]);
});

test("rank chart puts #1 at the top and #100 at the bottom", () => {
    expect(rankPath([1, 100], 100, 50, 0)).toBe("M0 0 L100 50");
    expect(rankPath([50], 10, 100, 0)).toBe("M0 49.5 L10 49.5"); // one week still draws a line
    expect(rankPath([], 10, 10)).toBe("");
    expect(rankPath([17, 12], 100, 34, 2, "fit")).toBe("M0 32 L100 2"); // sparklines show even a small rise
    expect(rankPath([40, 40], 100, 34, 2, "fit")).toBe("M0 17 L100 17");
});
