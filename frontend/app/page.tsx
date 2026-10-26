"use client";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { AuthDialog, useOctaveUser } from "./auth-dialog";
import { LedgerView } from "./ledger";
import { MARKET_FILTERS, MARKET_SORTS, artworkColor, held, lastMove, marketQuestion, matchesFilter, monogram, parseQuantity, rankPath, sidePrice, sortMarkets, type Account, type LiveMarket, type MarketFilter, type MarketSort, type TradeAction, type TradeSide } from "./trading";
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
// The song's recent Hot 100 ranks; higher on the chart is higher on the line.
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
// "#45 or higher" / "#53 or lower" / "off the chart": what the song must reach for YES to win.
function yesTarget(m: LiveMarket): string {
    if (m.shift > 0)
        return `#${m.baseline_rank - m.shift} or higher`;
    const target = m.baseline_rank - m.shift;
    return target > 100 ? "off the chart" : `#${target} or lower (or off the chart)`;
}
async function errorText(response: Response) {
    return (await response.text()).trim() || `Request failed (${response.status})`;
}
export default function Home() {
    const [authMode, setAuthMode] = useState<"signup" | "login" | null>(null);
    const { user, logout } = useOctaveUser();
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
    // Ask Firebase for the ID token on every request; it refreshes the hour-long token itself.
    const fetchAccount = useCallback(async () => {
        if (!user)
            return null;
        const response = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: "no-store" });
        return response.ok ? await response.json() as Account : null;
    }, [user]);
    useEffect(() => {
        let current = true;
        fetchMarkets()
            .then(list => { if (current) setMarkets(list); })
            .catch(error => { if (current) setLoadError(error instanceof Error ? error.message : "Could not load markets."); });
        return () => { current = false; };
    }, [fetchMarkets]);
    useEffect(() => {
        let current = true;
        void fetchAccount().then(a => { if (current) setAccount(a); });
        return () => { current = false; };
    }, [fetchAccount]);

    const selected = markets?.find(m => m.id === selectedId) ?? null;
    const goHome = () => { setSelectedId(null); setInfo(false); setWatchlist(false); setLedger(false); setFilter("All markets"); };
    const openMarket = (market: LiveMarket, choice: TradeSide = "yes") => { setInfo(false); setLedger(false); setSelectedId(market.id); setSide(choice); setOrderMessage(""); };
    const count = parseQuantity(quantity);
    const holding = selected ? held(account, selected.id, side) : 0;

    async function trade(action: TradeAction) {
        if (!selected)
            return;
        if (!user) {
            setAuthMode("signup");
            return;
        }
        if (count === null) {
            setOrderMessage("Enter a whole number of contracts.");
            return;
        }
        setBusy(true);
        try {
            const response = await fetch(`/api/markets/${selected.id}/${action}`, {
                method: "POST",
                headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
                body: JSON.stringify({ side, quantity: count }),
            });
            if (!response.ok)
                throw new Error(await errorText(response));
            const { balance } = await response.json() as { balance: number };
            setOrderMessage(`${action === "buy" ? "Bought" : "Sold"} ${count} ${side.toUpperCase()} for ♫ ${(sidePrice(selected, side) * count).toLocaleString()}. Balance ♫ ${balance.toLocaleString()}.`);
            const [list, me] = await Promise.all([fetchMarkets(), fetchAccount()]);
            setMarkets(list);
            setAccount(me);
        }
        catch (error) {
            setOrderMessage(error instanceof Error ? error.message : "Trade failed.");
        }
        finally {
            setBusy(false);
        }
    }

    const all = markets ?? [];
    const visible = sortMarkets(all.filter(m => `${m.title} ${m.artist}`.toLowerCase().includes(search.toLowerCase()) && (!watchlist || saved.includes(m.id)) && (filter === "Watchlist" ? saved.includes(m.id) : matchesFilter(m, filter))), sort);
    const onRadar = sortMarkets(all, "Most active").slice(0, 4);
    const chartDate = all[0]?.chart_date;
    return <div className="app-shell">
    <header className="header"><button className="brand" onClick={goHome} aria-label="Octave home"><Image src="/octave-notes.svg" alt="Octave" width={812} height={256} className="brand-logo" priority /></button><nav aria-label="Main navigation"><button className={!info && !watchlist && !ledger ? "nav-active" : ""} onClick={goHome}>Discover</button><button className={!info && !ledger && watchlist ? "nav-active" : ""} onClick={() => { setSelectedId(null); setInfo(false); setLedger(false); setWatchlist(true); setFilter("All markets"); setSearch(""); }}>Watchlist <span className="nav-count">{saved.length}</span></button><button className={ledger ? "nav-active" : ""} onClick={() => { setSelectedId(null); setInfo(false); setWatchlist(false); setLedger(true); }}>My ledger</button><button onClick={() => { setLedger(false); setInfo(true); }}>How it works <span>↗</span></button></nav><div className="account-actions">{user ? <>{account && <span className="balance-chip" title="Music Note balance">♫ {account.balance.toLocaleString()}</span>}<span className="user-name">{user.displayName || user.email}</span><button className="login" onClick={() => void logout()}>Log out</button></> : <><button className="login" onClick={() => setAuthMode("login")}>Log in</button><button className="primary small" onClick={() => setAuthMode("signup")}>Get started <span>↗</span></button></>}</div></header>
    <div className="ticker"><span className="ticker-label"><span className="live-dot"/> ON THE RADAR</span>{onRadar.map(m => { const move = lastMove(m); return <button key={m.id} onClick={() => openMarket(m)}>{m.title} <span className={move !== null && move < 0 ? "negative" : "positive"}>{move !== null && move < 0 ? "↘" : "↗"} {m.yes_price}%</span></button>; })}<span className="ticker-end">BILLBOARD HOT 100</span></div>
    <main>
      {ledger ? <LedgerView key={user?.uid ?? "signed-out"} user={user} onSignUp={() => setAuthMode("signup")}/> : info ? <section className="how-panel"><span className="eyebrow">A LITTLE MUSIC. A LITTLE INSTINCT.</span><h1>Your taste. Your edge.</h1><p>Predict what happens next on the Billboard Hot 100 using virtual Music Notes. Everyone starts with ♫ 10,000.</p><div className="how-steps"><article><b>01</b><h2>Find your track</h2><p>Every week a market opens for each song on the latest Hot 100, asking whether it will move a set number of spots on the next chart.</p></article><article><b>02</b><h2>Make your call</h2><p>Buy YES or NO contracts. Prices run from ♫ 1 to ♫ 99, and YES plus NO always cost ♫ 100. Sell them back any time before trading closes.</p></article><article><b>03</b><h2>Follow the charts</h2><p>When the next chart is in, markets settle automatically: every winning contract pays ♫ 100. Track it all in My ledger.</p></article></div><button className="primary" onClick={() => setInfo(false)}>Explore the markets →</button></section> : selected ? <>
      <button className="back-link" onClick={() => setSelectedId(null)}>← All markets</button>
      <div className="detail-heading"><Artwork market={selected}/><div><span className="eyebrow">BILLBOARD HOT 100 · NOW #{selected.baseline_rank}</span><h1>{marketQuestion(selected)}</h1><p>{selected.artist} <span className="dot-separator">·</span> Closes {closesLong(selected)}</p></div></div>
      <div className="detail-layout"><section className="chart-panel"><div className="chart-top"><div><span className="muted">YES price</span><strong>{selected.yes_price}% <small><Move market={selected}/></small></strong></div><span className="sample-badge">Hot 100 rank</span></div><div className="probability-chart"><div className="chart-grid"><span>#1</span><span>#25</span><span>#50</span><span>#75</span><span>#100</span></div><svg viewBox="0 0 700 240" preserveAspectRatio="none" role="img" aria-label={`${selected.title}'s Hot 100 rank over the last ${Math.max(selected.history.length, 1)} weeks, now #${selected.baseline_rank}`}><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#8e7bbc" stopOpacity=".24"/><stop offset="1" stopColor="#8e7bbc" stopOpacity="0"/></linearGradient></defs>{(() => { const line = rankPath(selected.history.length ? selected.history.map(h => h.rank) : [selected.baseline_rank], 700, 240, 0); return <><path d={`${line} V240 H0Z`} fill="url(#chartFill)"/><path d={line} stroke="#8c72b4" strokeWidth="3" fill="none" vectorEffect="non-scaling-stroke"/></>; })()}</svg></div><div className="chart-dates">{(selected.history.length ? selected.history : [{ chart_date: selected.chart_date, rank: selected.baseline_rank }]).map(h => <span key={h.chart_date}>{shortDate(h.chart_date)}</span>)}</div><div className="chart-bottom"><span>♫ {selected.volume.toLocaleString()} contracts traded</span><span>Settles on the {shortDate(selected.chart_date)} chart</span></div><div className="market-rules"><h3>The fine print, in tune.</h3><p>YES wins if {selected.title} is {yesTarget(selected)} on the Hot 100 dated {selected.chart_date}; it is #{selected.baseline_rank} now. NO wins otherwise. A song missing from that chart counts as #101.</p><p>Each winning contract pays ♫ 100 and losing contracts pay nothing. Trading closes {closesLong(selected)}, and the market settles automatically once the full chart is loaded.</p><p>Source: Billboard Hot 100 · Virtual Music Notes only</p></div></section>
      <aside className="order-panel"><div className="order-heading"><h2>Make your call</h2><span>{account ? `♫ ${account.balance.toLocaleString()}` : "♫ Music Notes"}</span></div><div className="order-song"><Artwork market={selected}/><div><strong>{selected.title}</strong><p>{selected.artist}</p></div></div><div className="side-picker"><button className={side === "yes" ? "up chosen" : "up"} onClick={() => { setSide("yes"); setOrderMessage(""); }}>YES <b>♫ {selected.yes_price}</b></button><button className={side === "no" ? "down chosen" : "down"} onClick={() => { setSide("no"); setOrderMessage(""); }}>NO <b>♫ {selected.no_price}</b></button></div><label className="amount-label" htmlFor="quantity">Contracts</label><div className="amount-input"><span>×</span><input id="quantity" type="number" min="1" max="1000000" step="1" value={quantity} onChange={e => setQuantity(e.target.value)}/></div><div className="quick-amounts">{[1, 5, 10, 25].map(n => <button key={n} onClick={() => setQuantity(String(n))}>{n}</button>)}</div><dl className="order-summary"><div><dt>Price per contract</dt><dd>♫ {sidePrice(selected, side)}</dd></div><div><dt>Total cost</dt><dd>{count ? `♫ ${(sidePrice(selected, side) * count).toLocaleString()}` : "—"}</dd></div><div><dt>You hold</dt><dd>{holding.toLocaleString()} {side.toUpperCase()}</dd></div><div className="payout"><dt>Potential payout <small>if {side.toUpperCase()} wins</small></dt><dd>♫ {count ? (count * 100).toLocaleString() : 0}</dd></div></dl><button className="primary" disabled={busy || count === null} onClick={() => void trade("buy")}>{user ? `Buy ${side.toUpperCase()}` : "Sign up to trade"} <span>↗</span></button>{user && <button className="primary secondary sell-button" disabled={busy || count === null || holding < (count ?? 1)} onClick={() => void trade("sell")}>Sell {side.toUpperCase()} <span>↙</span></button>}<p role="status" className="order-status">{orderMessage}</p><p className="order-disclaimer">All instinct. No real money.<br />Virtual Music Notes only.</p></aside></div>
      </> : <>
      {!watchlist && <section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="live-dot"/> THE MUSIC MOVES. YOU MAKE THE CALL.</span><h1>Good taste.<br />Better <span>predictions.</span></h1><p>Think you know the charts? Hope you don&apos;t fall flat!</p><div className="hero-actions"><a className="primary" href="#markets">Explore markets <span>↗</span></a><button className="primary secondary" onClick={() => setInfo(true)}>How it works <span>↗</span></button></div><div className="hero-footnote"><span>♫</span> Virtual Music Notes. Real bragging rights.</div></div><div className="hero-art" aria-hidden="true"><span className="orbit orbit-one"/><span className="orbit orbit-two"/><span className="floating-note note-one">♪</span><span className="floating-note note-two">✳</span><div className="record-sleeve"><span className="sleeve-top">OCTAVE RECORDS <span>VOL. 001</span></span><div className="vinyl"><span className="vinyl-label">octave.<small>SIDE A · TRUST YOUR TASTE</small><i /></span></div><span className="sleeve-bottom">SOUNDS LIKE A GOOD CALL. <span>↗</span></span></div><div className="floating-pill"><span className="pill-icon">↗</span><div>Your next favorite hit.<small>Your next great prediction.</small></div><HeroSparkline /></div><span className="art-caption">FOR THE RECORD, YOU CALLED IT.</span></div></section>}
      <section className="market-section" id="markets"><div className="section-heading"><div><span className="eyebrow">THE NEXT HIT IS YOUR CALL</span><h2>Find your next move<span className="purple-dot">.</span></h2></div><span className="week-label"><Icon name="clock" size={15}/> Weekly markets{chartDate && <> · settle on the {shortDate(chartDate)} chart</>} <span className="sample-badge">{all.length} live</span></span></div><div className="market-toolbar"><div className="filters" role="group" aria-label="Filter markets">{MARKET_FILTERS.map(f => <button key={f} aria-pressed={filter === f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{f === "Rising" ? "↗ " : f === "Falling" ? "↘ " : f === "New entries" ? "✳ " : ""}{f}</button>)}{filter === "Watchlist" && <button className="active">Watchlist</button>}</div><div className="search-sort"><label className="search-box"><Icon name="search" size={17}/><input aria-label="Search songs or artists" placeholder="Search songs or artists" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="Sort markets" value={sort} onChange={e => setSort(e.target.value as MarketSort)}>{MARKET_SORTS.map(s => <option key={s}>{s}</option>)}</select></div></div>
      {loadError ? <div className="empty-state"><Icon name="music" size={32}/><h3>Markets are unavailable.</h3><p>{loadError}</p></div>
        : markets === null ? <div className="empty-state"><Icon name="music" size={32}/><h3>Loading markets…</h3></div>
        : <><div className="market-grid">{visible.map(m => <article className="market-card" key={m.id}><div className="card-top"><Artwork market={m}/><div className="song-info"><span>Hot 100 <span className="tiny-dot">·</span> Now #{m.baseline_rank}</span><button onClick={() => openMarket(m)}>{m.title}</button><p>{m.artist}</p></div><button className={`save-button ${saved.includes(m.id) ? "saved" : ""}`} aria-label={`${saved.includes(m.id) ? "Remove" : "Save"} ${m.title} ${saved.includes(m.id) ? "from" : "to"} watchlist`} aria-pressed={saved.includes(m.id)} onClick={() => setSaved(saved.includes(m.id) ? saved.filter(id => id !== m.id) : [...saved, m.id])}><Icon name="star" size={18}/></button></div><button className="market-question" onClick={() => openMarket(m)}>{marketQuestion(m)}</button><div className="chance-row"><div><strong>{m.yes_price}<span>%</span></strong><span className="chance-caption">chance of YES</span></div><div className="sparkline-box"><Sparkline market={m}/><Move market={m}/></div></div><div className="card-trades"><button className="up" onClick={() => openMarket(m, "yes")}><span>YES</span><b>♫ {m.yes_price}</b></button><button className="down" onClick={() => openMarket(m, "no")}><span>NO</span><b>♫ {m.no_price}</b></button></div><div className="card-footer"><span>♫ {m.volume.toLocaleString()} contracts</span><span>Closes <b>{closesShort(m)}</b></span></div></article>)}</div>
        {!visible.length && <div className="empty-state"><Icon name="music" size={32}/><h3>{all.length ? "No tracks here yet." : "No open markets yet."}</h3><p>{!all.length ? "Markets open once the bots read a full Hot 100 chart." : watchlist ? "Tap a star on a market to save it to your watchlist." : "Try another artist, song, or filter."}</p>{all.length > 0 && <button className="text-button" onClick={() => { setSearch(""); setFilter("All markets"); setWatchlist(false); }}>See all markets →</button>}</div>}</>}
      </section><section className="join-banner"><span className="join-icon">✳</span><div><h2>A good ear deserves a little credit.</h2><p>Follow the charts. Make your predictions. Find your edge.</p></div><button className="primary" onClick={() => user ? setInfo(true) : setAuthMode("signup")}>{user ? "How it works" : "Join the next wave"} ↗</button></section>
      </>}
    </main><footer><button className="brand footer-brand" onClick={goHome}><Image src="/octave-notes.svg" alt="Octave" width={812} height={256} className="brand-logo" /></button><span>Made for music minds.</span><span className="footer-right">Virtual currency. Endless possibility. <span>© 2026 Octave</span></span></footer>
    {authMode && <AuthDialog mode={authMode} onClose={() => setAuthMode(null)}/>}
  </div>;
}
