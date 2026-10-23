"use client";
import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { held, marketQuestion, parseQuantity, sidePrice, type Account, type LiveMarket, type TradeAction, type TradeSide } from "./trading";

const PREVIEW = 12;

async function errorText(response: Response) {
    return (await response.text()).trim() || `Request failed (${response.status})`;
}

// Real markets from the Go backend, traded with Music Notes. Sits beside the
// illustrative sample cards until those are replaced.
export function LiveMarkets({ user, onSignUp }: { user: User | null; onSignUp: () => void }) {
    const [markets, setMarkets] = useState<LiveMarket[] | null>(null);
    const [loadError, setLoadError] = useState("");
    const [account, setAccount] = useState<Account | null>(null);
    const [sides, setSides] = useState<Record<number, TradeSide>>({});
    const [quantities, setQuantities] = useState<Record<number, string>>({});
    const [messages, setMessages] = useState<Record<number, string>>({});
    const [busy, setBusy] = useState<number | null>(null);
    const [showAll, setShowAll] = useState(false);

    // Ask Firebase for the ID token on every request; it refreshes the hour-long token itself.
    const loadAccount = useCallback(async () => {
        if (!user)
            return null;
        const response = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store" });
        return response.ok ? await response.json() as Account : null;
    }, [user]);

    useEffect(() => {
        let current = true;
        fetch("/api/markets", { cache: "no-store" })
            .then(async response => {
                if (!response.ok)
                    throw new Error(await errorText(response));
                return await response.json() as LiveMarket[];
            })
            .then(list => { if (current) setMarkets(list); })
            .catch(error => { if (current) setLoadError(error instanceof Error ? error.message : "Could not load markets."); });
        return () => { current = false; };
    }, []);
    useEffect(() => {
        let current = true;
        void loadAccount().then(a => { if (current) setAccount(a); });
        return () => { current = false; };
    }, [loadAccount]);

    async function trade(market: LiveMarket, action: TradeAction) {
        if (!user) {
            onSignUp();
            return;
        }
        const side = sides[market.id] ?? "yes";
        const quantity = parseQuantity(quantities[market.id] ?? "1");
        const say = (text: string) => setMessages(prev => ({ ...prev, [market.id]: text }));
        if (quantity === null) {
            say("Enter a whole number of contracts.");
            return;
        }
        setBusy(market.id);
        try {
            const response = await fetch(`/api/markets/${market.id}/${action}`, {
                method: "POST",
                headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
                body: JSON.stringify({ side, quantity }),
            });
            if (!response.ok)
                throw new Error(await errorText(response));
            const { balance } = await response.json() as { balance: number };
            say(`${action === "buy" ? "Bought" : "Sold"} ${quantity} ${side.toUpperCase()} for ♫ ${(sidePrice(market, side) * quantity).toLocaleString()}. Balance ♫ ${balance.toLocaleString()}.`);
            setAccount(await loadAccount());
        }
        catch (error) {
            say(error instanceof Error ? error.message : "Trade failed.");
        }
        finally {
            setBusy(null);
        }
    }

    const shown = markets && !showAll ? markets.slice(0, PREVIEW) : markets;
    return <section className="market-section live-section" id="live-markets">
      <div className="section-heading"><div><span className="eyebrow">REAL MARKETS · MUSIC NOTES</span><h2>Live markets<span className="purple-dot">.</span></h2></div>
        <span className="week-label">{user ? account ? <>Balance <b>♫ {account.balance.toLocaleString()}</b> · P&amp;L {account.realized_pnl >= 0 ? "+" : ""}{account.realized_pnl.toLocaleString()}</> : "Loading your balance…" : <button className="text-button" onClick={onSignUp}>Sign up to trade →</button>}</span></div>
      {loadError ? <p className="live-empty">Live markets are unavailable: {loadError}</p>
        : markets === null ? <p className="live-empty">Loading live markets…</p>
        : !markets.length ? <p className="live-empty">No open markets yet. They open once the bots read a full Hot 100 chart.</p>
        : <>
        <div className="live-list">{shown!.map(m => {
            const side = sides[m.id] ?? "yes";
            const text = quantities[m.id] ?? "1";
            const quantity = parseQuantity(text);
            const own = held(account, m.id, side);
            return <article className="live-market" key={m.id}>
              <div className="live-song"><strong>{m.title}</strong><span>{m.artist} · now #{m.baseline_rank}</span></div>
              <p className="live-question">{marketQuestion(m)}</p>
              <div className="card-trades live-sides" role="group" aria-label={`Side for ${m.title}`}>{(["yes", "no"] as const).map(s => <button key={s} className={`${s === "yes" ? "up" : "down"}${side === s ? " chosen" : ""}`} aria-pressed={side === s} onClick={() => setSides(prev => ({ ...prev, [m.id]: s }))}><span>{s.toUpperCase()}</span><b>♫ {sidePrice(m, s)}</b></button>)}</div>
              <div className="live-order">
                <label>Contracts<input type="number" min="1" step="1" value={text} onChange={e => setQuantities(prev => ({ ...prev, [m.id]: e.target.value }))}/></label>
                <span className="live-total">{quantity ? `♫ ${(sidePrice(m, side) * quantity).toLocaleString()}` : "—"}</span>
                <button className="primary small" disabled={busy === m.id || quantity === null} onClick={() => void trade(m, "buy")}>{user ? "Buy" : "Sign up"}</button>
                <button className="primary small secondary" disabled={busy === m.id || quantity === null || own < quantity} onClick={() => void trade(m, "sell")}>Sell</button>
              </div>
              <p className="live-meta">{own ? `You hold ${own} ${side.toUpperCase()}` : `Pays ♫ 100 per contract if ${side.toUpperCase()} wins`} · closes {new Date(m.closes_at).toLocaleString()}</p>
              <p role="status" className="order-status">{messages[m.id]}</p>
            </article>;
        })}</div>
        {markets.length > PREVIEW && <button className="text-button live-more" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${markets.length} markets`} →</button>}
      </>}
    </section>;
}
