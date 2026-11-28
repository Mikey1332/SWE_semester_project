"use client";
import { useEffect, useState } from "react";
import { sideLabel, type LiveMarket, type TradeSide } from "./trading";

type Level = { price: number; quantity: number };
type SideBook = { bids: Level[]; asks: Level[]; last_price: number | null };
type Book = Record<TradeSide, SideBook>;

function addDepth(levels: Level[]) {
  let total = 0;
  return levels.map((level) => {
    total += level.price * level.quantity;
    return { ...level, total };
  });
}

export default function OrderBook({
  market,
  side,
  refresh,
  onSide,
  onPrice,
}: {
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
          if (!controller.signal.aborted)
            setError("This market is no longer available.");
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
  const maxTotal = Math.max(
    visibleAsks[0]?.total ?? 0,
    visibleBids.at(-1)?.total ?? 0,
  );

  function renderLevels(
    levels: ReturnType<typeof addDepth>,
    label: "Asks" | "Bids",
  ) {
    if (levels.length === 0) {
      return (
        <tr>
          <th
            scope="row"
            className="px-[clamp(3px,1vw,9px)] py-[6px] text-left font-bold text-[var(--book-ink)]"
          >
            {label}
          </th>
          <td colSpan={3} className="px-[clamp(3px,1vw,9px)] py-[6px] text-right">
            No open {label.toLowerCase()}
          </td>
        </tr>
      );
    }
    return levels.map((level, index) => (
      <tr
        key={level.price}
        style={{ backgroundSize: `${(100 * level.total) / maxTotal}% 100%` }}
      >
        <th
          scope="row"
          className="px-[clamp(3px,1vw,9px)] py-[6px] text-left font-bold text-[var(--book-ink)]"
        >
          {index === (label === "Asks" ? levels.length - 1 : 0) ? label : ""}
        </th>
        <td className="px-[clamp(3px,1vw,9px)] py-[6px] text-right">
          <button
            type="button"
            className="whitespace-nowrap rounded-[4px] px-1 py-[3px] font-bold text-[var(--book-ink)] hover:bg-white hover:underline focus-visible:bg-white focus-visible:underline"
            onClick={() => onPrice(level.price)}
            aria-label={`Set limit price to ${level.price} Music Notes (${label.toLowerCase()})`}
          >
            ♫ {level.price}
          </button>
        </td>
        <td className="px-[clamp(3px,1vw,9px)] py-[6px] text-right">
          {level.quantity.toLocaleString()}
        </td>
        <td className="px-[clamp(3px,1vw,9px)] py-[6px] text-right">
          ♫ {level.total.toLocaleString()}
        </td>
      </tr>
    ));
  }

  return (
    <section
      className="mt-5 border-t border-line pt-4"
      aria-labelledby="market-book-title"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="market-book-title" className="text-[15px] font-bold">
          Order book
        </h2>
        <div
          className="flex gap-[5px]"
          role="group"
          aria-label="Order book outcome"
        >
          {(["yes", "no"] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={side === choice}
              className={`flex flex-1 justify-between rounded-[5px] border px-[9px] py-[5px] text-[11px] font-bold ${
                choice === "yes"
                  ? "bg-up-bg text-[#4f826a]"
                  : "bg-down-bg text-down"
              } ${side === choice ? "border-current opacity-100" : "border-transparent opacity-60"}`}
              onClick={() => {
                if (side !== choice) onSide(choice);
              }}
            >
              {sideLabel(market.baseline_rank, choice)}
            </button>
          ))}
        </div>
      </div>
      {error || !active ? (
        <p className="py-3 text-muted" role="status">
          {error || "Loading order book…"}
        </p>
      ) : (
        <>
          <table
            className="w-full border-collapse text-[12px] tabular-nums"
            aria-label={`${sideLabel(market.baseline_rank, side)} order book for ${market.title}`}
          >
            <thead className="border-b border-line text-muted">
              <tr>
                <th scope="col" className="px-[clamp(3px,1vw,9px)] py-[6px] text-left">
                  Side
                </th>
                <th scope="col" className="px-[clamp(3px,1vw,9px)] py-[6px] text-right">
                  Price
                </th>
                <th scope="col" className="px-[clamp(3px,1vw,9px)] py-[6px] text-right">
                  Contracts
                </th>
                <th scope="col" className="px-[clamp(3px,1vw,9px)] py-[6px] text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="book-depth-asks">
              {renderLevels(visibleAsks, "Asks")}
            </tbody>
            <tbody className="border-y border-line">
              <tr>
                <td colSpan={4} className="px-[clamp(3px,1vw,9px)] py-[6px] text-center font-semibold">
                  {active.last_price === null
                    ? "No trades yet"
                    : `Last trade ♫ ${active.last_price}`}
                </td>
              </tr>
            </tbody>
            <tbody className="book-depth-bids">
              {renderLevels(visibleBids, "Bids")}
            </tbody>
          </table>
          {(asks.length > 5 || bids.length > 5) && (
            <button
              className="inline-flex items-center gap-[9px] py-2 text-[12px]"
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Show fewer price levels" : "Show all price levels"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
