"use client";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { entryLabels, entryResult, marketQuestion, sideLabel, type Account, type LedgerEntry } from "./trading";

const FILTERS = [["All", null], ["Bought", "buy"], ["Sold", "sell"], ["Payouts", "payout"], ["Refunds", "refund"]] as const;

type Loaded = { entries: LedgerEntry[]; account: Account | null } | { error: string };

async function load(user: User): Promise<Loaded> {
    const headers = { Authorization: `Bearer ${await user.getIdToken()}` };
    const [ledger, me] = await Promise.all([
        fetch("/api/me/ledger", { headers, cache: "no-store" }),
        fetch("/api/auth/me", { headers, cache: "no-store" }),
    ]);
    if (!ledger.ok)
        return { error: (await ledger.text()).trim() || `Could not load your ledger (${ledger.status}).` };
    return { entries: await ledger.json(), account: me.ok ? await me.json() : null };
}

function question(e: LedgerEntry): string {
    if (e.title === null || e.shift === null || e.baseline_rank === null || e.chart_date === null)
        return "";
    return marketQuestion({ title: e.title, chart_date: e.chart_date, baseline_rank: e.baseline_rank });
}

// The signed-in user's Music Note ledger: every buy, sell and payout with the
// contracts it moved and how they turned out.
export function LedgerView({ user, onSignUp }: { user: User | null; onSignUp: () => void }) {
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [filter, setFilter] = useState<LedgerEntry["kind"] | null>(null);

    useEffect(() => {
        if (!user)
            return;
        let current = true;
        load(user)
            .then(result => { if (current) setLoaded(result); })
            .catch(error => { if (current) setLoaded({ error: error instanceof Error ? error.message : "Could not load your ledger." }); });
        return () => { current = false; };
    }, [user]);

    if (!user)
        return <section className="market-section ledger-section"><div className="live-empty">Sign up or log in to see the contracts you have bought and sold. <button className="text-button" onClick={onSignUp}>Sign up →</button></div></section>;

    const entries = loaded && "entries" in loaded ? loaded.entries : [];
    const shown = filter ? entries.filter(e => e.kind === filter) : entries;
    const account = loaded && "entries" in loaded ? loaded.account : null;
    return <section className="market-section ledger-section">
      <div className="section-heading"><div><span className="eyebrow">YOUR MUSIC NOTES</span><h2>My ledger<span className="purple-dot">.</span></h2></div>
        {account && <span className="week-label">Balance <b>♫ {account.balance.toLocaleString()}</b> · Realized P&amp;L {account.realized_pnl >= 0 ? "+" : ""}{account.realized_pnl.toLocaleString()} · {account.positions.length} open position{account.positions.length === 1 ? "" : "s"}</span>}</div>
      <div className="filters ledger-filters" role="group" aria-label="Filter ledger entries">{FILTERS.map(([label, kind]) => <button key={label} aria-pressed={filter === kind} className={filter === kind ? "active" : ""} onClick={() => setFilter(kind)}>{label}</button>)}</div>
      {loaded === null ? <p className="live-empty">Loading your ledger…</p>
        : "error" in loaded ? <p className="live-empty">{loaded.error}</p>
        : !shown.length ? <p className="live-empty">{filter ? "Nothing here yet." : "No entries yet. Buy contracts on the Discover tab."}</p>
        : <div className="ledger-table-wrap"><table className="ledger-table">
          <thead><tr><th>Date</th><th>Activity</th><th>Song</th><th>Side</th><th className="num">Contracts</th><th className="num">Price</th><th className="num">Notes</th><th className="num">Balance</th><th>Result</th></tr></thead>
          <tbody>{shown.map(e => {
              const result = entryResult(e);
              return <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td>{entryLabels[e.kind]}</td>
                <td className="ledger-song">{e.title ? <><strong>{e.title}</strong><span>{e.artist}</span><small>{question(e)}</small></> : "—"}</td>
                <td>{e.side ? <span className={e.side === "yes" ? "up ledger-side" : "down ledger-side"}>{sideLabel(e.baseline_rank ?? 0, e.side)}</span> : "—"}</td>
                <td className="num">{e.quantity?.toLocaleString() ?? "—"}</td>
                <td className="num">{e.price !== null ? `♫ ${e.price}` : "—"}</td>
                <td className={`num ${e.amount >= 0 ? "positive" : "negative"}`}>{e.amount >= 0 ? "+" : "−"}♫ {Math.abs(e.amount).toLocaleString()}</td>
                <td className="num">♫ {e.balance_after.toLocaleString()}</td>
                <td>{result && <span className={`ledger-result ${result.toLowerCase()}`}>{result}</span>}</td>
              </tr>;
          })}</tbody>
        </table></div>}
    </section>;
}
