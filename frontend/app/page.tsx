"use client";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import type { User } from "firebase/auth";
import { AuthDialog, useOctaveUser } from "./auth-dialog";
import { LedgerView } from "./ledger";
import { auth } from "./firebase";
import { readUnfinishedOrders, removeUnfinishedOrder, saveUnfinishedOrder, type UnfinishedOrder } from "./order-retry";
import { MARKET_FILTERS, MARKET_SORTS, artworkColor, held, lastMove, marketQuestion, matchesFilter, monogram, parseQuantity, rankPath, sidePrice, sideLabel, sortMarkets, type Account, type LiveMarket, type MarketFilter, type MarketSort, type TradeAction, type TradeSide } from "./trading";
type PendingOrder = {
    id: number;
    market_id: number;
    side: TradeSide;
    action: TradeAction;
    price: number;
    quantity: number;
    remaining: number;
    cancelled: boolean;
};

function Icon({ name, size = 20 }: {
    name: "search" | "arrow" | "music" | "chart" | "clock" | "star";
    size?: number;
}) {
    const paths = { search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>, arrow: <><path d="M4 17 17 4M5 4h12v12"/></>, music: <><path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="5.5" cy="18" rx="3.5" ry="3"/><ellipse cx="16.5" cy="16" rx="3.5" ry="3"/></>, chart: <><path d="M4 4v16h17M7 14l4-5 4 3 6-7"/></>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>, star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/> };
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Artwork({ market }: { market: LiveMarket }) {
    return <div className={`artwork ${artworkColor(market.id)}`} aria-label={`${market.artist} illustrated record artwork`}><span className="art-lines"/><span className="art-monogram">{monogram(market.artist)}</span><span className="art-record"/><span className="art-name">{market.artist}</span></div>;
}
function Sparkline({ market }: { market: LiveMarket }) {
    const move = lastMove(market);
    const ranks = market.history.length ? market.history.map(h => h.rank) : [market.baseline_rank];
    return <svg className={`sparkline ${move !== null && move < 0 ? "negative" : ""}`} viewBox="0 0 110 34" fill="none" aria-hidden="true"><path d={rankPath(ranks, 110, 34, 3, "fit")} stroke="currentColor" strokeWidth="2"/></svg>;
}
function HeroSparkline() {
    return <svg className="sparkline" viewBox="0 0 110 34" fill="none" aria-hidden="true"><path d="M1 29 10 26 17 29 25 20 33 23 41 17 50 21 58 13 68 16 76 8 86 13 95 6 109 3" stroke="currentColor" strokeWidth="2"/></svg>;
}
function Move({ market }: { market: LiveMarket }) {
    const move = lastMove(market);
    if (move === null)
        return <span className="positive">✳ New entry</span>;
    if (move === 0)
        return <span>→ Held at #{market.baseline_rank}</span>;
    return <span className={move > 0 ? "positive" : "negative"}>{move > 0 ? "↗" : "↘"} {Math.abs(move)} spot{Math.abs(move) === 1 ? "" : "s"} last week</span>;
}
const closesShort = (m: LiveMarket) => new Date(m.closes_at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
const closesLong = (m: LiveMarket) => new Date(m.closes_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
async function errorText(response: Response) {
    return (await response.text()).trim() || `Request failed (${response.status})`;
}
export default function Home() {
    const { user, logout } = useOctaveUser();
    return <TradingPage key={user?.uid ?? "signed-out"} user={user} logout={logout} />;
}

function TradingPage({ user, logout }: { user: User | null; logout: () => Promise<void> }) {
    const [authMode, setAuthMode] = useState<"signup" | "login" | null>(null);
    const [markets, setMarkets] = useState<LiveMarket[] | null>(null);
    const [loadError, setLoadError] = useState("");
    const [account, setAccount] = useState<Account | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [side, setSide] = useState<TradeSide>("yes");
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<MarketFilter | "Watchlist">("All markets");
    const [sort, setSort] = useState<MarketSort>("Chart rank");
    const [saved, setSaved] = useState<number[]>([]);
    const [quantity, setQuantity] = useState("10");
    const [limitPrice, setLimitPrice] = useState("50");
    const [orders, setOrders] = useState<PendingOrder[]>([]);
    const [unfinishedOrders, setUnfinishedOrders] = useState<UnfinishedOrder[]>([]);
    const [info, setInfo] = useState(false);
    const [watchlist, setWatchlist] = useState(false);
    const [ledger, setLedger] = useState(false);
    const [orderMessage, setOrderMessage] = useState("");
    const [busy, setBusy] = useState(false);

    const fetchMarkets = useCallback(async () => {
        const response = await fetch("/api/markets", { cache: "no-store" });
        if (!response.ok)
            throw new Error(await errorText(response));
        return await response.json() as LiveMarket[];
    }, []);
    const fetchAccount = useCallback(async () => {
        if (!user)
            return null;
        const response = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store" });
        if (!response.ok) {
            throw new Error(await errorText(response));
        }
        return await response.json() as Account;
    }, [user]);
    const fetchOrders = useCallback(async () => {
        if (!user) return [];
        const response = await fetch("/api/me/orders", {
            headers: { Authorization: `Bearer ${await user.getIdToken()}` },
            cache: "no-store",
        });
        if (!response.ok) throw new Error(await errorText(response));
        return await response.json() as PendingOrder[];
    }, [user]);
    useEffect(() => {
        let current = true;
        async function loadUnfinishedOrders() {
            if (!current) return;
            if (!user) {
                setUnfinishedOrders([]);
                return;
            }
            try {
                setUnfinishedOrders(readUnfinishedOrders(localStorage, user.uid));
            } catch {
                setOrderMessage("Could not load saved orders.");
            }
        }
        void loadUnfinishedOrders();
        function storageChanged() {
            void loadUnfinishedOrders();
        }
        window.addEventListener("storage", storageChanged);
        return () => {
            current = false;
            window.removeEventListener("storage", storageChanged);
        };
    }, [user]);

    useEffect(() => {
        let current = true;

        async function loadOrders() {
            try {
                const list = await fetchOrders();
                if (current) {
                    setOrders(list);
                }
            } catch (error) {
                if (current) {
                    setOrderMessage(error instanceof Error ? error.message : "Could not load orders.");
                }
            }
        }

        void loadOrders();
        return () => { current = false; };
    }, [fetchOrders]);

    useEffect(() => {
        let current = true;
        fetchMarkets()
            .then(list => { if (current) setMarkets(list); })
            .catch(error => { if (current) setLoadError(error instanceof Error ? error.message : "Could not load markets."); });
        return () => { current = false; };
    }, [fetchMarkets]);
    useEffect(() => {
        let current = true;
        void fetchAccount()
            .then(a => { if (current) setAccount(a); })
            .catch(error => {
                if (current) setOrderMessage(error instanceof Error ? error.message : "Could not load account.");
            });
        return () => { current = false; };
    }, [fetchAccount]);

    const selected = markets?.find(m => m.id === selectedId) ?? null;
    const goHome = () => { setSelectedId(null); setInfo(false); setWatchlist(false); setLedger(false); setFilter("All markets"); };
    const openMarket = (market: LiveMarket, choice: TradeSide = "yes") => { setInfo(false); setLedger(false); setSelectedId(market.id); setSide(choice); setLimitPrice(String(sidePrice(market, choice))); setOrderMessage(""); };
    const count = parseQuantity(quantity);
    const holding = selected ? held(account, selected.id, side) : 0;
    const price = Number(limitPrice);
    const validPrice = limitPrice.trim() !== "" && Number.isInteger(price) && price >= 1 && price <= 99;

    async function trade(action: TradeAction) {
        if (!selected) return;
        if (!user) {
            setAuthMode("signup");
            return;
        }
        if (count === null || !validPrice) {
            setOrderMessage("Enter a whole number of contracts and a price from 1 to 99.");
            return;
        }
        const order: UnfinishedOrder = {
            user_id: user.uid,
            market_id: selected.id,
            request_id: crypto.randomUUID(),
            side: side,
            action: action,
            price: price,
            quantity: count,
        };
        await submitOrder(order);
    }

    async function submitOrder(order: UnfinishedOrder) {
        if (!user || order.user_id !== user.uid) return;
        setBusy(true);
        try {
            saveUnfinishedOrder(localStorage, order);
            setUnfinishedOrders(readUnfinishedOrders(localStorage, user.uid));
            const token = await user.getIdToken();
            const response = await fetch(`/api/markets/${order.market_id}/orders`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    request_id: order.request_id,
                    side: order.side,
                    action: order.action,
                    price: order.price,
                    quantity: order.quantity,
                }),
            });
            if (!response.ok) {
                if (response.status === 400 || response.status === 409) {
                    removeUnfinishedOrder(localStorage, order);
                    if (auth.currentUser?.uid === user.uid) {
                        setUnfinishedOrders(readUnfinishedOrders(localStorage, user.uid));
                    }
                }
                throw new Error(await errorText(response));
            }
            const result = await response.json() as PendingOrder;
            removeUnfinishedOrder(localStorage, order);
            if (auth.currentUser?.uid !== user.uid) return;
            setUnfinishedOrders(readUnfinishedOrders(localStorage, user.uid));
            const filled = result.quantity - result.remaining;
            let message = `Order accepted. ${filled} filled; ${result.remaining} remaining.`;
            if (result.cancelled) {
                message = `Order cancelled. ${filled} filled before cancellation.`;
            }
            setOrderMessage(message);
            try {
                const markets = await fetchMarkets();
                const account = await fetchAccount();
                const orders = await fetchOrders();
                if (auth.currentUser?.uid !== user.uid) return;
                setMarkets(markets);
                setAccount(account);
                setOrders(orders);
            } catch {
                if (auth.currentUser?.uid === user.uid) {
                    setOrderMessage(message + " Refresh to update your account.");
                }
            }
        } catch (error) {
            if (auth.currentUser?.uid === user.uid) {
                const message = error instanceof Error ? error.message : "Order failed.";
                setOrderMessage(message + " If the order appears above, you can retry it.");
            }
        } finally {
            setBusy(false);
        }
    }

    async function refreshOrders() {
        if (!user) return;
        setBusy(true);
        try {
            const account = await fetchAccount();
            const orders = await fetchOrders();
            if (auth.currentUser?.uid !== user.uid) return;
            setAccount(account);
            setOrders(orders);
            setOrderMessage("Orders updated.");
        } catch (error) {
            if (auth.currentUser?.uid === user.uid) {
                setOrderMessage(error instanceof Error ? error.message : "Could not update orders.");
            }
        } finally {
            setBusy(false);
        }
    }

    async function cancelOrder(id: number) {
        if (!user) return;
        setBusy(true);
        try {
            const response = await fetch(`/api/orders/${id}/cancel`, {
                method: "POST",
                headers: { Authorization: `Bearer ${await user.getIdToken()}` },
            });
            if (!response.ok) throw new Error(await errorText(response));
            if (auth.currentUser?.uid !== user.uid) return;
            setOrderMessage("Order cancelled.");
            try {
                const orders = await fetchOrders();
                const account = await fetchAccount();
                if (auth.currentUser?.uid !== user.uid) return;
                setOrders(orders);
                setAccount(account);
            } catch {
                if (auth.currentUser?.uid === user.uid) {
                    setOrderMessage("Order cancelled. Refresh to update your account.");
                }
            }
        } catch (error) {
            if (auth.currentUser?.uid === user.uid) {
                setOrderMessage(error instanceof Error ? error.message : "Could not cancel order.");
            }
        } finally {
            setBusy(false);
        }
    }

    const all = markets ?? [];
    const visible = sortMarkets(all.filter(m => `${m.title} ${m.artist}`.toLowerCase().includes(search.toLowerCase()) && (!watchlist || saved.includes(m.id)) && (filter === "Watchlist" ? saved.includes(m.id) : matchesFilter(m, filter))), sort);
    const chartDate = all[0]?.chart_date;
    return <div className="app-shell">
    <header className="header"><button className="brand" onClick={goHome} aria-label="Octave home"><Image src="/octave-black.png" alt="Octave" width={2170} height={725} className="brand-logo" priority /></button><nav aria-label="Main navigation"><button className={!info && !watchlist && !ledger ? "nav-active" : ""} aria-current={!info && !watchlist && !ledger ? "page" : undefined} onClick={goHome}>Discover</button><button className={!info && !ledger && watchlist ? "nav-active" : ""} aria-current={!info && !ledger && watchlist ? "page" : undefined} onClick={() => { setSelectedId(null); setInfo(false); setLedger(false); setWatchlist(true); setFilter("All markets"); setSearch(""); }}>Watchlist <span className="nav-count">{saved.length}</span></button><button className={ledger ? "nav-active" : ""} aria-current={ledger ? "page" : undefined} onClick={() => { setSelectedId(null); setInfo(false); setWatchlist(false); setLedger(true); }}>My ledger</button><button className={info ? "nav-active" : ""} aria-current={info ? "page" : undefined} onClick={() => { setLedger(false); setInfo(true); }}>How it works</button></nav><div className="account-actions">{user ? <>{account && <span className="balance-chip" title="Music Note balance">♫ {account.balance.toLocaleString()}</span>}<span className="user-name">{user.displayName || user.email}</span><button className="login" onClick={() => void logout()}>Log out</button></> : <><button className="login" onClick={() => setAuthMode("login")}>Log in</button><button className="primary small" onClick={() => setAuthMode("signup")}>Get started <span>↗</span></button></>}</div></header>
    <main>
      {user && unfinishedOrders.filter(order => order.user_id === user.uid).map(order => (
        <div key={order.request_id} role="status">
          <span>Unconfirmed order: {order.action.toUpperCase()} {order.quantity} {order.side === "yes" ? "UP/STAY" : "DOWN"} at ♫ {order.price} for market {order.market_id}. </span>
          <button className="text-button" disabled={busy} onClick={() => void submitOrder(order)}>Retry (may place order)</button>
        </div>
      ))}
      {!selected && orderMessage && <p role="status">{orderMessage}</p>}
      {ledger ? <LedgerView key={user?.uid ?? "signed-out"} user={user} onSignUp={() => setAuthMode("signup")}/> : info ? <section className="how-panel"><span className="eyebrow">A LITTLE MUSIC. A LITTLE INSTINCT.</span><h1>Your taste. Your edge.</h1><p>Predict what happens next on the Billboard Hot 100 using virtual Music Notes. Everyone starts with ♫ 10,000.</p><div className="how-steps"><article><b>01</b><h2>Find your track</h2><p>Every week a market opens for each song on the latest Hot 100, asking whether it will go up or down on the next chart.</p></article><article><b>02</b><h2>Make your call</h2><p>Buy UP or DOWN contracts. At #1, choose STAY or DOWN. Prices run from ♫ 1 to ♫ 99, and both sides together cost ♫ 100. Place a sell order before trading closes; it fills when a matching buyer is available.</p></article><article><b>03</b><h2>Follow the charts</h2><p>When the next chart is in, markets settle automatically: every winning contract pays ♫ 100. Unchanged ranks are refunded except at #1, where STAY wins. Track it all in My ledger.</p></article></div><button className="primary" onClick={() => setInfo(false)}>Explore the markets →</button></section> : selected ? <>
      <button className="back-link" onClick={() => setSelectedId(null)}>← All markets</button>
      <div className="detail-heading">
        <Artwork market={selected}/>
        <div className="detail-heading-info">
          <h1>{marketQuestion(selected)}</h1>
          <p>{selected.artist} <span className="dot-separator">·</span> Closes {closesLong(selected)}</p>
        </div>
        <div className="chart-source">
          <Image src="/billboard-logo.svg" alt="Billboard Hot 100" width={190} height={40} className="billboard-logo"/>
          <strong>Current rank #{selected.baseline_rank}</strong>
        </div>
      </div>
      <div className="detail-layout"><section className="chart-panel"><div className="chart-top"><div><span className="muted">{sideLabel(selected.baseline_rank, "yes")} estimate</span><strong>{selected.yes_price}% <small><Move market={selected}/></small></strong></div><span className="sample-badge">Hot 100 rank</span></div><div className="probability-chart"><div className="chart-grid"><span>#1</span><span>#25</span><span>#50</span><span>#75</span><span>#100</span></div><svg viewBox="0 0 700 240" preserveAspectRatio="none" role="img" aria-label={`${selected.title}'s Hot 100 rank over the last ${Math.max(selected.history.length, 1)} weeks, now #${selected.baseline_rank}`}><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#8e7bbc" stopOpacity=".24"/><stop offset="1" stopColor="#8e7bbc" stopOpacity="0"/></linearGradient></defs>{(() => { const line = rankPath(selected.history.length ? selected.history.map(h => h.rank) : [selected.baseline_rank], 700, 240, 0); return <><path d={`${line} V240 H0Z`} fill="url(#chartFill)"/><path d={line} stroke="#8c72b4" strokeWidth="3" fill="none" vectorEffect="non-scaling-stroke"/></>; })()}</svg></div><div className="chart-dates">{(selected.history.length ? selected.history : [{ chart_date: selected.chart_date, rank: selected.baseline_rank }]).map(h => <span key={h.chart_date}>{shortDate(h.chart_date)}</span>)}</div><div className="chart-bottom"><span>♫ {selected.volume.toLocaleString()} contracts traded</span><span>Settles on the {shortDate(selected.chart_date)} chart</span></div><div className="market-rules"><p>Winning contracts pay ♫ 100. Trading closes {closesLong(selected)}.</p></div></section>
      <aside className="order-panel">
        <div className="order-heading">
          <h2>Make your call</h2>
          <span>{account ? `♫ ${account.balance.toLocaleString()}` : "♫ Music Notes"}</span>
        </div>

        <div className="order-song">
          <Artwork market={selected}/>
          <div>
            <strong>{selected.title}</strong>
            <p>{selected.artist}</p>
          </div>
        </div>

        <div className="side-picker">
          <button
            className={side === "yes" ? "up chosen" : "up"}
            onClick={() => {
              setSide("yes");
              setLimitPrice(String(selected.yes_price));
              setOrderMessage("");
            }}
          >
            {sideLabel(selected.baseline_rank, "yes")} <b>♫ {selected.yes_price}</b>
          </button>
          <button
            className={side === "no" ? "down chosen" : "down"}
            onClick={() => {
              setSide("no");
              setLimitPrice(String(selected.no_price));
              setOrderMessage("");
            }}
          >
            DOWN <b>♫ {selected.no_price}</b>
          </button>
        </div>

        <label className="amount-label" htmlFor="limit-price">Limit price (1–99)</label>
        <div className="amount-input">
          <span>♫</span>
          <input
            id="limit-price"
            type="number"
            min="1"
            max="99"
            step="1"
            value={limitPrice}
            onChange={e => setLimitPrice(e.target.value)}
          />
        </div>

        <label className="amount-label" htmlFor="quantity">Contracts</label>
        <div className="amount-input">
          <span>×</span>
          <input
            id="quantity"
            type="number"
            min="1"
            max="1000000"
            step="1"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
          />
        </div>

        <div className="quick-amounts">
          {[1, 5, 10, 25].map(n => (
            <button key={n} onClick={() => setQuantity(String(n))}>{n}</button>
          ))}
        </div>

        <dl className="order-summary">
          <div><dt>Limit price</dt><dd>{validPrice ? `♫ ${price}` : "—"}</dd></div>
          <div><dt>Limit total</dt><dd>{count && validPrice ? `♫ ${(price * count).toLocaleString()}` : "—"}</dd></div>
          <div><dt>You hold</dt><dd>{holding.toLocaleString()} {sideLabel(selected.baseline_rank, side)}</dd></div>
          <div className="payout">
            <dt>Potential payout <small>if {sideLabel(selected.baseline_rank, side)} wins</small></dt>
            <dd>♫ {count ? (count * 100).toLocaleString() : 0}</dd>
          </div>
        </dl>

        <button
          className="primary"
          disabled={busy || count === null || !validPrice}
          onClick={() => void trade("buy")}
        >
          {user ? `Buy ${sideLabel(selected.baseline_rank, side)}` : "Sign up to trade"} <span>↗</span>
        </button>

        {user && (
          <button
            className="primary secondary sell-button"
            disabled={busy || count === null || !validPrice || holding < count}
            onClick={() => void trade("sell")}
          >
            Sell {sideLabel(selected.baseline_rank, side)} <span>↙</span>
          </button>
        )}

        {user && <button className="text-button" disabled={busy} onClick={() => void refreshOrders()}>Refresh orders</button>}

        {orders.filter(order => order.market_id === selected.id).map(order => (
          <div className="open-order" key={order.id}>
            <span>
              <strong>{order.action.toUpperCase()} {sideLabel(selected.baseline_rank, order.side)}</strong>
              <span>♫ {order.price} each · {order.remaining} waiting</span>
            </span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void cancelOrder(order.id)}
            >
              Cancel
            </button>
          </div>
        ))}

        <p role="status" className="order-status">{orderMessage}</p>
      </aside></div>
      </> : <>
      {!watchlist && <section className="hero"><div className="hero-copy"><h1>Good taste.<br />Better <span>predictions.</span></h1><p>Think you know the charts? Hope you don&apos;t fall flat!</p><div className="hero-actions"><a className="primary" href="#markets">Explore markets <span>↗</span></a><button className="primary secondary" onClick={() => setInfo(true)}>How it works <span>↗</span></button></div></div><div className="hero-art" aria-hidden="true"><span className="orbit orbit-one"/><span className="orbit orbit-two"/><span className="floating-note note-one">♪</span><span className="floating-note note-two">✳</span><div className="record-sleeve"><span className="sleeve-top">OCTAVE RECORDS <span>VOL. 001</span></span><div className="vinyl"><span className="vinyl-label">octave.<small>SIDE A · TRUST YOUR TASTE</small><i /></span></div></div><div className="floating-pill"><span className="pill-icon">↗</span><div>Your next favorite hit.<small>Your next great prediction.</small></div><HeroSparkline /></div><span className="art-caption">SOUNDS LIKE A GOOD CALL.</span></div></section>}
      <section className="market-section" id="markets"><div className="section-heading"><div><h2>Find your next move<span className="purple-dot">.</span></h2></div><span className="week-label"><Icon name="clock" size={15}/> Weekly markets{chartDate && <> · settle on the {shortDate(chartDate)} chart</>} <span className="sample-badge">{all.length} live</span></span></div><div className="market-toolbar"><div className="filters" role="group" aria-label="Filter markets">{MARKET_FILTERS.map(f => <button key={f} aria-pressed={filter === f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{f === "Rising" ? "↗ " : f === "Falling" ? "↘ " : f === "New entries" ? "✳ " : ""}{f}</button>)}{filter === "Watchlist" && <button className="active">Watchlist</button>}</div><div className="search-sort"><label className="search-box"><Icon name="search" size={17}/><input aria-label="Search songs or artists" placeholder="Search songs or artists" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="Sort markets" value={sort} onChange={e => setSort(e.target.value as MarketSort)}>{MARKET_SORTS.map(s => <option key={s}>{s}</option>)}</select></div></div>
      {loadError ? <div className="empty-state"><Icon name="music" size={32}/><h3>Markets are unavailable.</h3><p>{loadError}</p></div>
        : markets === null ? <div className="empty-state"><Icon name="music" size={32}/><h3>Loading markets…</h3></div>
        : <><div className="market-grid">{visible.map(m => <article className="market-card" key={m.id}><div className="card-top"><Artwork market={m}/><div className="song-info"><span>Hot 100 <span className="tiny-dot">·</span> Now #{m.baseline_rank}</span><button onClick={() => openMarket(m)}>{m.title}</button><p>{m.artist}</p></div><button className={`save-button ${saved.includes(m.id) ? "saved" : ""}`} aria-label={`${saved.includes(m.id) ? "Remove" : "Save"} ${m.title} ${saved.includes(m.id) ? "from" : "to"} watchlist`} aria-pressed={saved.includes(m.id)} onClick={() => setSaved(saved.includes(m.id) ? saved.filter(id => id !== m.id) : [...saved, m.id])}><Icon name="star" size={18}/></button></div><button className="market-question" onClick={() => openMarket(m)}>{marketQuestion(m)}</button><div className="chance-row"><div><strong>{m.yes_price}<span>%</span></strong><span className="chance-caption">bot estimate</span></div><div className="sparkline-box"><Sparkline market={m}/><Move market={m}/></div></div><div className="card-trades"><button className="up" onClick={() => openMarket(m, "yes")}><span>{sideLabel(m.baseline_rank, "yes")}</span><b>♫ {m.yes_price}</b></button><button className="down" onClick={() => openMarket(m, "no")}><span>DOWN</span><b>♫ {m.no_price}</b></button></div><div className="card-footer"><span>♫ {m.volume.toLocaleString()} contracts</span><span>Closes <b>{closesShort(m)}</b></span></div></article>)}</div>
        {!visible.length && <div className="empty-state"><Icon name="music" size={32}/><h3>{all.length ? "No tracks here yet." : "No open markets yet."}</h3><p>{!all.length ? "Markets open once the bots read a full Hot 100 chart." : watchlist ? "Tap a star on a market to save it to your watchlist." : "Try another artist, song, or filter."}</p>{all.length > 0 && <button className="text-button" onClick={() => { setSearch(""); setFilter("All markets"); setWatchlist(false); }}>See all markets →</button>}</div>}</>}
      </section><section className="join-banner"><span className="join-icon">✳</span><div><h2>A good ear deserves a little credit.</h2><p>Follow the charts. Make your predictions. Find your edge.</p></div><button className="primary" onClick={() => user ? setInfo(true) : setAuthMode("signup")}>{user ? "How it works" : "Join the next wave"} ↗</button></section>
      </>}
    </main><footer><button className="brand footer-brand" onClick={goHome}><Image src="/octave-black.png" alt="Octave" width={2170} height={725} className="brand-logo" /></button><span className="footer-tagline">Made for music minds.</span><span className="footer-right">© 2026 Octave</span></footer>
    {authMode && <AuthDialog mode={authMode} onClose={() => setAuthMode(null)}/>}
  </div>;
}
