// Shapes returned by the Go backend's GET /markets and GET /auth/me.
export type LiveMarket = {
    id: number;
    title: string;
    artist: string;
    chart_date: string;
    baseline_rank: number;
    shift: number;
    yes_price: number;
    no_price: number;
    closes_at: string;
};
export type Position = { market_id: number; side: TradeSide; quantity: number; cost_basis: number };
export type Account = { balance: number; realized_pnl: number; positions: Position[] };
export type TradeSide = "yes" | "no";
export type TradeAction = "buy" | "sell";

// "Will Golden rise 5+ spots from #12 on the 2026-10-31 chart?"
export function marketQuestion(m: LiveMarket): string {
    const move = m.shift > 0 ? `rise ${m.shift}+` : `fall ${-m.shift}+`;
    return `Will ${m.title} ${move} spot${Math.abs(m.shift) === 1 ? "" : "s"} from #${m.baseline_rank} on the ${m.chart_date} chart?`;
}

export function sidePrice(m: LiveMarket, side: TradeSide): number {
    return side === "yes" ? m.yes_price : m.no_price;
}

export function held(account: Account | null, marketId: number, side: TradeSide): number {
    return account?.positions.find(p => p.market_id === marketId && p.side === side)?.quantity ?? 0;
}

// A whole number of contracts the backend will accept (1 to 1,000,000), or null.
export function parseQuantity(text: string): number | null {
    const n = Number(text);
    return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : null;
}

// One row of GET /me/ledger. Contract and market fields are null for grants
// (and contract fields for trades made before they were recorded).
export type LedgerEntry = {
    id: number;
    created_at: string;
    kind: "grant" | "buy" | "sell" | "payout";
    amount: number;
    balance_after: number;
    side: TradeSide | null;
    quantity: number | null;
    price: number | null;
    market_id: number | null;
    title: string | null;
    artist: string | null;
    chart_date: string | null;
    baseline_rank: number | null;
    shift: number | null;
    market_status: "open" | "resolved" | null;
    outcome: TradeSide | null;
};

export const entryLabels: Record<LedgerEntry["kind"], string> = { grant: "Starting balance", buy: "Bought", sell: "Sold", payout: "Payout" };

// How the contracts in an entry turned out: still open, or won/lost once the market resolved.
export function entryResult(e: LedgerEntry): "Open" | "Won" | "Lost" | "" {
    if (!e.market_status || !e.side)
        return "";
    if (e.market_status !== "resolved")
        return "Open";
    return e.outcome === e.side ? "Won" : "Lost";
}
