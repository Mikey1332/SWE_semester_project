import { expect, test } from "vitest";
import { held, marketQuestion, parseQuantity, sidePrice, type Account, type LiveMarket } from "../app/trading";

const market: LiveMarket = {
    id: 7, title: "Golden", artist: "HUNTR/X", chart_date: "2026-10-31", baseline_rank: 12,
    shift: 5, yes_price: 62, no_price: 38, closes_at: "2026-10-26T04:00:00Z",
};

test("market question reads the bot's shift", () => {
    expect(marketQuestion(market)).toBe("Will Golden rise 5+ spots from #12 on the 2026-10-31 chart?");
    expect(marketQuestion({ ...market, shift: -1 })).toBe("Will Golden fall 1+ spot from #12 on the 2026-10-31 chart?");
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
