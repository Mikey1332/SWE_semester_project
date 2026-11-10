"use client";
import "./groups.css";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { User } from "firebase/auth";

type Group = { id: number; name: string; members: number; is_private?: boolean; is_owner?: boolean };
type Member = { user_id: number; name: string; is_owner: boolean };
type Row = { rank: number; user_id: number; name: string; pnl: number };
type Created = { id: number; invite_code?: string };
type RunAction = (action: () => Promise<unknown>) => Promise<void>;

async function api(user: User, path: string, init: RequestInit = {}) {
    const response = await fetch(`/api${path}`, { ...init, cache: "no-store",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" } });
    if (!response.ok)
        throw new Error((await response.text()).trim() || `Request failed (${response.status}).`);
    return response.status === 204 ? null : response.json();
}

const urlParam = (key: string) =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get(key) ?? "";
const joinLink = (id: number, code?: string) =>
    `${window.location.origin}/?join=${id}${code ? `&code=${encodeURIComponent(code)}` : ""}`;
const BANNERS = ["#292e29", "#8d75b4", "#3d5c4c", "#5f4a85", "#414b40", "#a8743f"];
const initials = (name: string) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";

// A shareable private-group code is "<groupID>-<secret>", so people only paste one thing.
// Also accepts a full invite link (…/?join=<id>&code=<secret>).
function parseJoinCode(value: string): { id: number; code: string } | null {
    const text = value.trim();
    try {
        const url = new URL(text);
        const id = Number(url.searchParams.get("join"));
        const code = url.searchParams.get("code");
        if (id > 0 && code) return { id, code };
    } catch {
        // not a URL, fall through to the code format
    }
    const match = text.match(/^(\d+)-(\S+)$/);
    return match ? { id: Number(match[1]), code: match[2] } : null;
}

// Placeholder cards shown only while no real public groups exist. Negative IDs can never match a real group.
const SAMPLE_GROUPS: Group[] = [
    { id: -1, name: "Chart Toppers", members: 128 },
    { id: -2, name: "Billboard Bandits", members: 94 },
    { id: -3, name: "Hot 100 Heads", members: 76 },
    { id: -4, name: "Top 40 Traders", members: 61 },
    { id: -5, name: "Pop Pickers", members: 52 },
    { id: -6, name: "Rhythm & Bets", members: 37 },
];

function Badges({ group }: { group: Group }) {
    return <>
      {group.is_private && <span className="groups-badge">Private</span>}
      {group.is_owner && <span className="groups-badge owner">Owner</span>}
    </>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);
    return <div className="groups-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="groups-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="groups-modal-head">
          <h3>{title}</h3>
          <button type="button" className="groups-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>;
}

const ACCESS = [
    { value: "private", label: "Private", help: "Play with only people you invite to join." },
    { value: "public", label: "Public", help: "Play with anyone who chooses to join." },
] as const;

function CreateGroupModal({ onCreate, onClose }: {
    onCreate: (name: string, isPrivate: boolean) => Promise<Created>; onClose: () => void;
}) {
    const [name, setName] = useState("");
    const [access, setAccess] = useState<"private" | "public">("private");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [created, setCreated] = useState<{ id: number; code: string } | null>(null);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        onCreate(name.trim(), access === "private")
            .then(res => { if (res.invite_code) setCreated({ id: res.id, code: res.invite_code }); else onClose(); })
            .catch(err => setError(err.message))
            .finally(() => setBusy(false));
    };

    if (created) {
        const shareCode = `${created.id}-${created.code}`;
        return <Modal title="Group created" onClose={onClose}>
          <div className="groups-modal-body">
            <p>Share this invite code to bring friends into <b>{name}</b>. It is only shown once, so save it now.</p>
            <code className="groups-code">{shareCode}</code>
            <div className="groups-actions">
              <button type="button" className="groups-btn" onClick={() => navigator.clipboard.writeText(shareCode)}>Copy code</button>
              <button type="button" className="groups-btn" onClick={() => navigator.clipboard.writeText(joinLink(created.id, created.code))}>Copy invite link</button>
            </div>
          </div>
          <div className="groups-modal-foot"><button type="button" className="primary" onClick={onClose}>Done</button></div>
        </Modal>;
    }

    return <Modal title="Create A Group" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="groups-modal-body">
          <div className="groups-label-row">
            <label htmlFor="group-name">Group Name <span className="req">*</span></label>
            <span className="groups-count">{name.length}/64</span>
          </div>
          <input id="group-name" className="groups-input" value={name} maxLength={64} placeholder="Enter Group Name"
                 onChange={e => setName(e.target.value)} required/>
          <div className="groups-label-row"><span>Group Access <span className="req">*</span></span></div>
          {ACCESS.map(o => <label key={o.value} className={access === o.value ? "groups-option selected" : "groups-option"}>
            <input type="radio" name="group-access" checked={access === o.value} onChange={() => setAccess(o.value)}/>
            <span><b>{o.label}</b><small>{o.help}</small></span>
          </label>)}
          {error && <p role="alert" className="groups-alert">{error}</p>}
        </div>
        <div className="groups-modal-foot">
          <button type="submit" className="primary" disabled={busy || !name.trim()}>Create Group</button>
        </div>
      </form>
    </Modal>;
}

// "invited" is set when someone opens a public group's invite link (no secret code needed).
function JoinModal({ initialValue, invited, onJoin, onClose }: {
    initialValue: string; invited: { id: number; name?: string } | null;
    onJoin: (id: number, code: string) => Promise<void>; onClose: () => void;
}) {
    const [value, setValue] = useState(initialValue);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const submit = (e: FormEvent) => {
        e.preventDefault();
        const parsed = invited ? { id: invited.id, code: "" } : parseJoinCode(value);
        if (!parsed) {
            setError("That doesn't look like a valid invite code. Paste the full code or invite link you were given.");
            return;
        }
        setBusy(true);
        setError("");
        onJoin(parsed.id, parsed.code)
            .then(onClose)
            .catch(err => { setError(err.message); setBusy(false); });
    };

    return <Modal title={invited ? "Join Group" : "Join With Code"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="groups-modal-body">
          {invited
            ? <p>You have been invited to join <b>{invited.name ?? "this group"}</b>.</p>
            : <>
                <div className="groups-label-row"><label htmlFor="join-code">Invite code</label></div>
                <input id="join-code" className="groups-input" value={value} onChange={e => setValue(e.target.value)}
                       placeholder="Paste your invite code or link" required/>
              </>}
          {error && <p role="alert" className="groups-alert">{error}</p>}
        </div>
        <div className="groups-modal-foot">
          <button type="submit" className="primary" disabled={busy || (!invited && !value.trim())}>Join Group</button>
        </div>
      </form>
    </Modal>;
}

// Private groups only expose their invite code when they are created, so the button needs a code we know.
function InviteButton({ group, code, onCopy }: {
    group: Group; code?: string; onCopy: (group: Group, code?: string) => void;
}) {
    if (group.is_private && !code)
        return group.is_owner
            ? <span title="This group's invite code was only shown when it was created."><button type="button" className="groups-link" disabled style={{ pointerEvents: "none" }}>Invite Friends</button></span>
            : null;
    return <button type="button" className="groups-link" onClick={() => onCopy(group, code)}>Invite Friends ↗</button>;
}

function GroupCard({ user, group, invite, onOpen }: { user: User; group: Group; invite: ReactNode; onOpen: () => void }) {
    const [board, setBoard] = useState<Row[] | null>(null);
    useEffect(() => {
        api(user, `/groups/${group.id}/leaderboard?period=week`).then(setBoard).catch(() => setBoard([]));
    }, [user, group.id, group.members]);

    return <article className="groups-gcard">
      <div className="groups-gcard-head">
        <div>
          <button type="button" className="groups-gname" onClick={onOpen}>{group.name}</button>
          <p className="groups-sub">Group Size: {group.members}<Badges group={group}/></p>
        </div>
        {invite}
      </div>
      {board === null ? <p className="groups-muted">Loading leaderboard…</p> : board.length === 0 ? <p className="groups-muted">No ranked players yet.</p> :
        <table className="groups-table">
          <thead><tr><th>Rank</th><th>Player</th><th>P&amp;L (week)</th></tr></thead>
          <tbody>{board.slice(0, 3).map(r => <tr key={r.user_id}><td>#{r.rank}</td><td>{r.name}</td><td>{r.pnl}</td></tr>)}</tbody>
        </table>}
      <button type="button" className="groups-link" style={{ alignSelf: "flex-start" }} onClick={onOpen}>View group →</button>
    </article>;
}

function PublicGroupCard({ group, joined, sample, onJoin, onOpen }: {
    group: Group; joined?: boolean; sample?: boolean; onJoin?: () => void; onOpen?: () => void;
}) {
    const tag = sample ? "Sample" : joined ? "Joined" : null;
    return <article className="groups-pcard" title={sample ? "Sample group for preview. Create a public group to see a real one here." : undefined}>
      <div className="groups-banner" style={{ background: BANNERS[Math.abs(group.id) % BANNERS.length] }}>
        {initials(group.name)}
        {tag && <span className="groups-sample">{tag}</span>}
      </div>
      <div className="groups-pbody">
        <h4 className="groups-pname">{group.name}</h4>
        <p className="groups-sub">Group Size: {group.members}</p>
        <button type="button" className="groups-outline" disabled={sample} onClick={joined ? onOpen : onJoin}>
          {joined ? "View Group" : "Join Group"}
        </button>
      </div>
    </article>;
}

function GroupDetail({ user, group, invite, run, onBack }: {
    user: User; group: Group; invite: ReactNode; run: RunAction; onBack: () => void;
}) {
    const [members, setMembers] = useState<Member[]>([]);
    const [board, setBoard] = useState<Row[]>([]);
    const [period, setPeriod] = useState("week");
    const isOwner = !!group.is_owner;

    useEffect(() => {
        api(user, `/groups/${group.id}/members`).then(setMembers).catch(() => setMembers([]));
    }, [user, group.id, group.members, group.is_owner]);
    useEffect(() => {
        api(user, `/groups/${group.id}/leaderboard?period=${period}`).then(setBoard).catch(() => setBoard([]));
    }, [user, group.id, group.members, period]);

    return <div>
      <button type="button" className="groups-back" onClick={onBack}>← All groups</button>
      <div className="groups-detail">
        <div className="groups-detail-head">
          <div>
            <h3>{group.name}</h3>
            <p className="groups-sub">Group Size: {group.members}<Badges group={group}/></p>
          </div>
          <div className="groups-actions">
            {invite}
            <span title={isOwner ? "Owners can't leave. Transfer ownership to another member or delete the group first." : undefined}>
              <button type="button" className="groups-btn" disabled={isOwner} style={isOwner ? { pointerEvents: "none" } : undefined}
                onClick={() => run(async () => { await api(user, `/groups/${group.id}/leave`, { method: "POST" }); onBack(); })}>Leave group</button>
            </span>
            {isOwner && <button type="button" className="groups-btn danger" onClick={() => {
                if (window.confirm(`Delete "${group.name}" for everyone? This cannot be undone.`))
                    run(async () => { await api(user, `/groups/${group.id}`, { method: "DELETE" }); onBack(); });
            }}>Delete group</button>}
          </div>
        </div>

        <div className="groups-section">
          <h4 className="groups-subhead">Members</h4>
          <ul className="groups-members">{members.map(m => <li key={m.user_id} className="groups-member">
            <span>{m.name}{m.is_owner && <span className="groups-badge owner">Owner</span>}</span>
            {isOwner && !m.is_owner && <span className="groups-actions">
              <button type="button" className="groups-btn" onClick={() => {
                  if (window.confirm(`Make ${m.name} the owner? You will lose owner controls.`))
                      run(() => api(user, `/groups/${group.id}/owner`, { method: "POST", body: JSON.stringify({ user_id: m.user_id }) }));
              }}>Make owner</button>
              <button type="button" className="groups-btn danger" onClick={() => {
                  if (window.confirm(`Remove ${m.name} from this group?`))
                      run(() => api(user, `/groups/${group.id}/members/${m.user_id}/remove`, { method: "POST" }));
              }}>Remove</button>
            </span>}
          </li>)}</ul>
        </div>

        <div className="groups-section">
          <h4 className="groups-subhead">Leaderboard</h4>
          <div className="groups-seg" role="group" aria-label="Leaderboard period">{["week", "month", "all"].map(p =>
            <button key={p} type="button" aria-pressed={p === period} onClick={() => setPeriod(p)}>{p}</button>)}</div>
          <table className="groups-table">
            <thead><tr><th>Rank</th><th>Player</th><th>P&amp;L</th></tr></thead>
            <tbody>{board.map(r => <tr key={r.user_id}><td>#{r.rank}</td><td>{r.name}</td><td>{r.pnl}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>;
}

// Friend groups: browse and search public groups, create public/private groups, join by invite code or link,
// manage members (owner only), and see each group's leaderboard.
export function GroupsView({ user, onSignUp }: { user: User | null; onSignUp: () => void }) {
    const [groups, setGroups] = useState<Group[]>([]);
    const [publicGroups, setPublicGroups] = useState<Group[]>([]);
    const [publicLoaded, setPublicLoaded] = useState(false);
    const [selected, setSelected] = useState<number | null>(null);
    const [query, setQuery] = useState("");
    // An invite link (/?join=<groupID>&code=<code>) opens the join dialog.
    const [prefill, setPrefill] = useState(() => ({ id: Number(urlParam("join")) || 0, code: urlParam("code") }));
    const [modal, setModal] = useState<"create" | "join" | null>(() => Number(urlParam("join")) > 0 ? "join" : null);
    const [codes, setCodes] = useState<Record<number, string>>({});
    const [message, setMessage] = useState("");
    const [notice, setNotice] = useState("");

    const refresh = () => user ? api(user, "/me/groups").then(setGroups) : Promise.resolve();

    useEffect(() => {
        if (user)
            api(user, "/me/groups").then(setGroups).catch(e => setMessage(e.message));
    }, [user]);
    // Public groups, filtered by the search box (debounced while typing). Reloaded whenever the user's own
    // groups change (create, join, leave, delete) so this list is never stale.
    useEffect(() => {
        if (!user) return;
        const t = setTimeout(() => {
            api(user, `/groups?search=${encodeURIComponent(query.trim())}`)
                .then(r => { setPublicGroups(r); setPublicLoaded(true); })
                .catch(e => setMessage(e.message));
        }, query ? 250 : 0);
        return () => clearTimeout(t);
    }, [user, query, groups]);

    if (!user)
        return <section className="market-section"><div className="live-empty">Sign up or log in to create or join a group. <button className="text-button" onClick={onSignUp}>Sign up</button></div></section>;

    const run: RunAction = action =>
        action().then(() => { setMessage(""); return refresh(); }).catch(e => setMessage(e.message));
    const createGroup = async (name: string, isPrivate: boolean): Promise<Created> => {
        const res: Created = await api(user, "/groups", { method: "POST", body: JSON.stringify({ name, is_private: isPrivate }) });
        const code = res.invite_code;
        if (code) setCodes(c => ({ ...c, [res.id]: code }));
        await refresh();
        return res;
    };
    const joinGroup = async (id: number, code = "") => {
        await api(user, `/groups/${id}/join`, { method: "POST", body: JSON.stringify({ code }) });
        await refresh();
        setSelected(id);
    };
    const closeJoin = () => {
        setModal(null);
        setPrefill({ id: 0, code: "" });
        if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
    };
    const copyInvite = (group: Group, code?: string) =>
        navigator.clipboard.writeText(joinLink(group.id, code))
            .then(() => { setNotice("Invite link copied to clipboard."); setTimeout(() => setNotice(""), 2500); })
            .catch(() => setMessage("Could not copy the invite link."));

    const current = groups.find(g => g.id === selected);
    // Show sample cards only when the server has no public groups at all (and the user is not searching).
    const showSamples = publicLoaded && publicGroups.length === 0 && !query.trim();
    const invite = (g: Group) => <InviteButton group={g} code={codes[g.id]} onCopy={copyInvite}/>;
    const invited = prefill.id > 0 && !prefill.code
        ? { id: prefill.id, name: publicGroups.find(g => g.id === prefill.id)?.name }
        : null;
    const initialValue = prefill.id > 0 && prefill.code ? `${prefill.id}-${prefill.code}` : "";

    return <section className="market-section">
      {message && <p role="alert" className="groups-alert">{message}</p>}
      {notice && <p role="status" className="groups-toast">{notice}</p>}

      {current ? <GroupDetail user={user} group={current} invite={invite(current)} run={run} onBack={() => setSelected(null)}/> : <>
        <div className="groups-hero">
          <div className="groups-hero-top">
            <div>
              <span className="eyebrow">COMPETE WITH FRIENDS</span>
              <h2>Groups<span className="purple-dot">.</span></h2>
              <p>Join or create a group to play with friends.</p>
            </div>
            <label className="groups-search">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search public groups" aria-label="Search public groups"/>
            </label>
          </div>
          <div className="groups-cta">
            <span>Create a new group of your own and invite friends!</span>
            <div className="groups-actions">
              <button type="button" className="groups-btn" onClick={() => setModal("join")}>Join with code</button>
              <button type="button" className="primary small" onClick={() => setModal("create")}>Create Group</button>
            </div>
          </div>
        </div>

        <h3 className="groups-subhead">My Groups</h3>
        {groups.length === 0 ? <div className="live-empty" style={{ marginBottom: 30 }}>You are not in any groups yet.</div> :
          <div className="groups-list">{groups.map(g =>
            <GroupCard key={g.id} user={user} group={g} invite={invite(g)} onOpen={() => setSelected(g.id)}/>)}</div>}

        <h3 className="groups-subhead">Public Groups</h3>
        {showSamples ? <>
            <div className="groups-grid">{SAMPLE_GROUPS.map(g => <PublicGroupCard key={g.id} group={g} sample/>)}</div>
            <p className="groups-muted">Sample groups are shown until real public groups exist.</p>
          </> : publicGroups.length === 0 ? <div className="live-empty">{query.trim() ? "No public groups match your search." : "No public groups to join right now."}</div> :
          <div className="groups-grid">{publicGroups.map(g =>
            <PublicGroupCard key={g.id} group={g} joined={groups.some(m => m.id === g.id)}
              onJoin={() => run(() => joinGroup(g.id))} onOpen={() => setSelected(g.id)}/>)}</div>}
      </>}

      {modal === "create" && <CreateGroupModal onCreate={createGroup} onClose={() => setModal(null)}/>}
      {modal === "join" && <JoinModal initialValue={initialValue} invited={invited} onJoin={joinGroup} onClose={closeJoin}/>}
    </section>;
}