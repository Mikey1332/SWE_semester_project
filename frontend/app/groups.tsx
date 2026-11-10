"use client";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";

type Group = { id: number; name: string; members: number };
type Row = { rank: number; user_id: number; name: string; pnl: number };

async function api(user: User, path: string, init: RequestInit = {}) {
    const response = await fetch(`/api${path}`, { ...init, cache: "no-store",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" } });
    if (!response.ok)
        throw new Error((await response.text()).trim() || `Request failed (${response.status}).`);
    return response.status === 204 ? null : response.json();
}

// Friend groups: create one, join one by its ID, and see each group's leaderboard.
export function GroupsView({ user, onSignUp }: { user: User | null; onSignUp: () => void }) {
    const [groups, setGroups] = useState<Group[]>([]);
    const [selected, setSelected] = useState<number | null>(null);
    const [board, setBoard] = useState<Row[]>([]);
    const [period, setPeriod] = useState("week");
    const [name, setName] = useState("");
    const [joinId, setJoinId] = useState("");
    const [message, setMessage] = useState("");

    const refresh = () => user ? api(user, "/me/groups").then(setGroups) : Promise.resolve();
    useEffect(() => {
        if (user)
            api(user, "/me/groups").then(setGroups).catch(e => setMessage(e.message));
    }, [user]);
    useEffect(() => {
        if (user && selected !== null)
            api(user, `/groups/${selected}/leaderboard?period=${period}`).then(setBoard).catch(e => setMessage(e.message));
    }, [user, selected, period]);

    if (!user)
        return <section className="market-section"><div className="live-empty">Sign up or log in to create or join a group. <button className="text-button" onClick={onSignUp}>Sign up</button></div></section>;

    const run = (action: () => Promise<unknown>) =>
        action().then(() => { setMessage(""); return refresh(); }).catch(e => setMessage(e.message));
    return <section className="market-section">
      <div className="section-heading"><div><span className="eyebrow">COMPETE WITH FRIENDS</span><h2>Groups<span className="purple-dot">.</span></h2></div></div>
      <form onSubmit={e => { e.preventDefault(); run(async () => { const { id } = await api(user, "/groups", { method: "POST", body: JSON.stringify({ name }) }); setName(""); setSelected(id); }); }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New group name" aria-label="New group name" required/>
        <button type="submit">Create group</button>
      </form>
      <form onSubmit={e => { e.preventDefault(); run(async () => { await api(user, `/groups/${joinId}/join`, { method: "POST" }); setSelected(Number(joinId)); setJoinId(""); }); }}>
        <input value={joinId} onChange={e => setJoinId(e.target.value)} placeholder="Group ID" aria-label="Group ID to join" inputMode="numeric" pattern="[0-9]+" required/>
        <button type="submit">Join group</button>
      </form>
      {message && <p role="alert">{message}</p>}
      {groups.length === 0 ? <div className="live-empty">You are not in any groups yet.</div> :
        <ul>{groups.map(g => <li key={g.id}><button aria-pressed={g.id === selected} onClick={() => setSelected(g.id)}>{g.name}</button> · ID {g.id} · {g.members} members</li>)}</ul>}
      {selected !== null && <>
          <button
          type="button"
          onClick={() => {
            run(async () => {
              await api(user, `/groups/${selected}/leave`, {
                method: "POST",
              });

              setSelected(null);
              setBoard([]);
            });
          }}
        >
          Leave group
        </button>
        <div role="group" aria-label="Leaderboard period">{["week", "month", "all"].map(p =>
          <button key={p} aria-pressed={p === period} onClick={() => setPeriod(p)}>{p}</button>)}</div>
        <table><thead><tr><th>Rank</th><th>Player</th><th>P&amp;L</th></tr></thead>
          <tbody>{board.map(r => <tr key={r.user_id}><td>#{r.rank}</td><td>{r.name}</td><td>{r.pnl}</td></tr>)}</tbody></table>
      </>}
    </section>;
}
