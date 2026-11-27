"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { formatNotes } from "./trading";
import { loadLeaderboard, type LeaderboardEntry } from "./leaderboard-data";
import "./leaderboard.css";

export function LeaderboardView({ user }: { user: User | null }) {
    const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
    const [currentUserId, setCurrentUserId] = useState<number | null>(null);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            try {
                const board = await loadLeaderboard(user, controller.signal);
                if (!controller.signal.aborted) {
                    setEntries(board.entries);
                    setCurrentUserId(board.currentUserId);
                    setError("");
                }
            } catch (err) {
                if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load the charts.");
            }
        }
        void load();
        const timer = window.setInterval(() => void load(), 60000);
        return () => { controller.abort(); window.clearInterval(timer); };
    }, [revision, user]);

    function name(entry: LeaderboardEntry) {
        return entry.user_id === currentUserId
            ? <strong className="charts-your-name">{entry.name} <small>(you)</small></strong>
            : <span className="charts-name">{entry.name}</span>;
    }

    return <section className="market-section charts-section" aria-labelledby="charts-title">
        <div className="charts-heading">
            <div><p>Think your taste can help you climb the charts?</p>
                <h1 id="charts-title">The Octave Charts</h1>
                <p>Our Top Ten Charters</p>
            </div>
            <button className="primary secondary" onClick={() => setRevision(value => value + 1)}>Refresh charts ↗</button>
        </div>
        {error && <p className="charts-error" role="alert">{error}</p>}
        {!entries && !error && <p className="live-empty" role="status">Loading the charts…</p>}
        {entries?.length === 0 && !error && <p className="live-empty">No profiles have synced yet. Sign in to add your profile to the charts.</p>}
        {!!entries?.length && <>
            <ol className="charts-podium" aria-label="Top three profiles">
                {entries.slice(0, 3).map(entry => <li key={entry.user_id} value={entry.rank} className={"charts-podium-card charts-place-" + entry.rank}>
                    {entry.rank === 1 && <span className="charts-note" role="img" aria-label="Chart leader">♪</span>}
                    <span className="charts-rank" aria-label={"Rank " + entry.rank}>{entry.rank}</span>
                    {name(entry)}
                    <span className={entry.pnl >= 0 ? "positive" : "negative"}>{formatNotes(entry.pnl)}</span>
                    <small>Total P&amp;L</small>
                </li>)}
            </ol>
            {entries.length > 3 && <ol className="charts-list" start={4} aria-label="Profiles ranked four to ten">
                {entries.slice(3).map(entry => <li key={entry.user_id}>
                    <span className="charts-row-rank" aria-label={"Rank " + entry.rank}>{entry.rank}</span>
                    {name(entry)}
                    <span className={"charts-pnl " + (entry.pnl >= 0 ? "positive" : "negative")}>{formatNotes(entry.pnl)}</span>
                </li>)}
            </ol>}
        </>}
    </section>;
}
