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
    volume: number; // contracts bought so far
    history: RankPoint[]; // last 10 Hot 100 ranks, oldest first; the last is baseline_rank
};
export type RankPoint = { chart_date: string; rank: number };
export type Position = { market_id: number; side: TradeSide; quantity: number; cost_basis: number };
export type Account = { balance: number; realized_pnl: number; positions: Position[] };
export type TradeSide = "yes" | "no";
export type TradeAction = "buy" | "sell";

export function marketQuestion(
    m: { title: string; baseline_rank: number; chart_date: string }
): string {
    const date = new Date(m.chart_date + "T12:00:00");

    const formattedDate = date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });

    if (m.baseline_rank === 1) {
        return `Will ${m.title} stay at #1 or go down on ${formattedDate}?`;
    }
    return `Will ${m.title} go up or down from #${m.baseline_rank} on ${formattedDate}?`;
}

export function sideLabel(rank: number, side: TradeSide): string {
    if (side === "no") return "DOWN";
    if (rank === 1) return "STAY";
    return "UP";
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
    kind: "grant" | "buy" | "sell" | "payout" | "refund";
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
    outcome: TradeSide | "refund" | null;
};

export const entryLabels: Record<LedgerEntry["kind"], string> = { grant: "Starting balance", buy: "Bought", sell: "Sold", payout: "Payout", refund: "Refund" };

// How the contracts in an entry turned out: still open, or won/lost once the market resolved.
export function entryResult(e: LedgerEntry): "Open" | "Won" | "Lost" | "Refunded" | "" {
    if (!e.market_status || !e.side)
        return "";
    if (e.market_status !== "resolved")
        return "Open";
    if (e.outcome === "refund") {
        if (e.kind === "refund") return "Refunded";
        return "";
    }
    return e.outcome === e.side ? "Won" : "Lost";
}

const ARTWORK_COLORS = ["rose", "sand", "blue", "olive", "violet", "rust"] as const;

// Stable record-sleeve color per market, from the sample cards' palette.
export function artworkColor(id: number): string {
    return ARTWORK_COLORS[Math.abs(id) % ARTWORK_COLORS.length];
}

// "Taylor Swift" -> "TS", "HUNTR/X" -> "HX".
export function monogram(artist: string): string {
    return artist.split(/[\s/&,]+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase();
}

// Spots the song moved on its latest chart (positive = rose), or null for a new entry.
export function lastMove(m: LiveMarket): number | null {
    const h = m.history;
    return h.length < 2 ? null : h[h.length - 2].rank - h[h.length - 1].rank;
}

export const MARKET_FILTERS = ["All markets", "Rising", "Falling", "New entries"] as const;
export type MarketFilter = (typeof MARKET_FILTERS)[number];

export function matchesFilter(m: LiveMarket, filter: MarketFilter): boolean {
    const move = lastMove(m);
    switch (filter) {
        case "Rising": return move !== null && move > 0;
        case "Falling": return move !== null && move < 0;
        case "New entries": return move === null;
        default: return true;
    }
}

export const MARKET_SORTS = ["Chart rank", "Highest chance", "Most active"] as const;
export type MarketSort = (typeof MARKET_SORTS)[number];

export function sortMarkets(list: LiveMarket[], sort: MarketSort): LiveMarket[] {
    const by = sort === "Highest chance" ? (a: LiveMarket, b: LiveMarket) => b.yes_price - a.yes_price
        : sort === "Most active" ? (a: LiveMarket, b: LiveMarket) => b.volume - a.volume
        : (a: LiveMarket, b: LiveMarket) => a.baseline_rank - b.baseline_rank;
    return [...list].sort((a, b) => by(a, b) || a.id - b.id);
}

// SVG path through chart ranks across width x height, better ranks higher. "chart" scales
// to the whole Hot 100 (#1 top, #100 bottom); "fit" stretches to the song's own range so a
// small move still shows in a sparkline.
export function rankPath(ranks: number[], width: number, height: number, pad = 2, scale: "chart" | "fit" = "chart"): string {
    const points = ranks.length === 1 ? [ranks[0], ranks[0]] : ranks;
    if (!points.length)
        return "";
    const [best, worst] = scale === "fit" ? [Math.min(...points), Math.max(...points)] : [1, 100];
    const y = (rank: number) => best === worst ? height / 2
        : pad + (Math.min(Math.max(rank, best), worst) - best) / (worst - best) * (height - 2 * pad);
    return points.map((rank, i) => `${i ? "L" : "M"}${+(i / (points.length - 1) * width).toFixed(1)} ${+y(rank).toFixed(1)}`).join(" ");
}
