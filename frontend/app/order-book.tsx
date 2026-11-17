import { useEffect, useState } from "react";
import { sideLabel, type LiveMarket, type TradeSide } from "./trading";

type Level = { price: number; quantity: number };
type SideBook = { bids: Level[]; asks: Level[]; last_price: number | null };
type Book = Record<TradeSide, SideBook>;

function addDepth(levels: Level[]) {
    let total = 0;
    return levels.map(level => {
        total += level.price * level.quantity;
        return { ...level, total };
    });
}

export default function OrderBook({ market, side, refresh, onSide, onPrice }: {
    market: LiveMarket;
    side: TradeSide;
    refresh: number;
    onSide: (side: TradeSide) => void;
    onPrice: (price: number) => void;
}) {
    const [book, setBook] = useState<Book | null>(null);
    const [error, setError] = useState("");
    const [expanded, setExpanded] = useState(false);
    const marketId = market.id;

    useEffect(() => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout>;

        async function load() {
            try {
                const response = await fetch(`/api/markets/${marketId}/orderbook`, {
                    cache: "no-store",
                    signal: controller.signal,
                });
                if (response.status === 404) {
                    if (!controller.signal.aborted) setError("This market is no longer available.");
                    return;
                }
                if (!response.ok) throw new Error("Could not load the order book.");
                const snapshot: Book = await response.json();
                if (controller.signal.aborted) return;
                setBook(snapshot);
                setError("");
            } catch {
                if (controller.signal.aborted) return;
                setError("Could not load the order book. Retrying…");
            }
            timer = setTimeout(load, 5000);
        }

        void load();
        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [marketId, refresh]);

    const active = book?.[side];
    const asks = addDepth(active?.asks ?? []);
    const bids = addDepth(active?.bids ?? []);
    const visibleAsks = asks.slice(0, expanded ? undefined : 5).reverse();
    const visibleBids = bids.slice(0, expanded ? undefined : 5);
    const maxTotal = Math.max(visibleAsks[0]?.total ?? 0, visibleBids.at(-1)?.total ?? 0);

    function renderLevels(levels: ReturnType<typeof addDepth>, label: "Asks" | "Bids") {
        if (levels.length === 0) {
            return <tr><th scope="row">{label}</th><td colSpan={3}>No open {label.toLowerCase()}</td></tr>;
        }
        return levels.map((level, index) => (
            <tr key={level.price} style={{ backgroundSize: `${100 * level.total / maxTotal}% 100%` }}>
                <th scope="row">{index === (label === "Asks" ? levels.length - 1 : 0) ? label : ""}</th>
                <td>
                    <button type="button" onClick={() => onPrice(level.price)}
                        aria-label={`Set limit price to ${level.price} Music Notes (${label.toLowerCase()})`}>
                        ♫ {level.price}
                    </button>
                </td>
                <td>{level.quantity.toLocaleString()}</td>
                <td>♫ {level.total.toLocaleString()}</td>
            </tr>
        ));
    }

    return (
        <section className="market-book" aria-labelledby="market-book-title">
            <div className="market-book-heading">
                <h2 id="market-book-title">Order book</h2>
                <div className="side-picker" role="group" aria-label="Order book outcome">
                    {(["yes", "no"] as const).map(choice => (
                        <button key={choice} type="button" aria-pressed={side === choice}
                            className={`${choice === "yes" ? "up" : "down"}${side === choice ? " chosen" : ""}`}
                            onClick={() => { if (side !== choice) onSide(choice); }}>
                            {sideLabel(market.baseline_rank, choice)}
                        </button>
                    ))}
                </div>
            </div>
            {error || !active ? <p className="market-book-status" role="status">{error || "Loading order book…"}</p> : (
                <>
                    <table aria-label={`${sideLabel(market.baseline_rank, side)} order book for ${market.title}`}>
                        <thead><tr><th scope="col">Side</th><th scope="col">Price</th><th scope="col">Contracts</th><th scope="col">Total</th></tr></thead>
                        <tbody className="market-book-asks">{renderLevels(visibleAsks, "Asks")}</tbody>
                        <tbody className="market-book-last">
                            <tr><td colSpan={4}>{active.last_price === null ? "No trades yet" : `Last trade ♫ ${active.last_price}`}</td></tr>
                        </tbody>
                        <tbody className="market-book-bids">{renderLevels(visibleBids, "Bids")}</tbody>
                    </table>
                    {(asks.length > 5 || bids.length > 5) && (
                        <button className="text-button" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                            {expanded ? "Show fewer price levels" : "Show all price levels"}
                        </button>
                    )}
                </>
            )}
        </section>
    );
}
