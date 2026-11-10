"use client";

import "./groups.css";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { User } from "firebase/auth";

type Group = { id: number; name: string; members: number; is_private?: boolean; is_owner?: boolean };
type Member = { user_id: number; name: string; is_owner: boolean };
type Row = { rank: number; user_id: number; name: string; pnl: number };
type Created = { id: number; invite_code?: string };
type RunAction = (action: () => Promise<unknown>) => Promise<void>;
type InviteFormat = "code" | "link";

async function api(user: User, path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
    headers.set("Content-Type", "application/json");

    const response = await fetch(`/api${path}`, {
        ...init,
        cache: "no-store",
        headers,
    });

    if (!response.ok)
        throw new Error((await response.text()).trim() || `Request failed (${response.status}).`);

    return response.status === 204 ? null : response.json();
}

const errorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "Something went wrong.";

const urlParam = (key: string) =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get(key) ?? "";

const validID = (id: number) => Number.isSafeInteger(id) && id > 0;

const joinLink = (id: number, code?: string) =>
    `${window.location.origin}/?join=${id}${code ? `&code=${encodeURIComponent(code)}` : ""}`;

const BANNERS = ["#292e29", "#8d75b4", "#3d5c4c", "#5f4a85", "#414b40", "#a8743f"];

const initials = (name: string) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase() || "?";

// Private codes include the group ID: "<groupID>-<secret>".
// Full invite links are also accepted.
function parseJoinCode(value: string): { id: number; code: string } | null {
    const text = value.trim();

    try {
        const url = new URL(text);
        const id = Number(url.searchParams.get("join"));
        const code = url.searchParams.get("code") ?? "";

        if (["http:", "https:"].includes(url.protocol) && validID(id))
            return { id, code };
    } catch {
        // Continue with the combined code format.
    }

    const match = text.match(/^(\d+)-(\S+)$/);
    if (!match) return null;

    const id = Number(match[1]);
    return validID(id) ? { id, code: match[2] } : null;
}

function GroupAvatar({ group }: { group: Group }) {
    return <span className="groups-avatar"
        style={{ background: BANNERS[Math.abs(group.id) % BANNERS.length] }}
        aria-hidden="true">
      {initials(group.name)}
    </span>;
}

function Badges({ group }: { group: Group }) {
    return <>
      {group.is_private && <span className="groups-badge">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
             stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="7" width="10" height="7" rx="2"/>
          <path d="M5 7V5a3 3 0 0 1 6 0v2"/>
        </svg>
        Private
      </span>}
      {group.is_owner && <span className="groups-badge owner">Owner</span>}
    </>;
}

function Modal({ title, onClose, children }: {
    title: string; onClose: () => void; children: ReactNode;
}) {
    const modalRef = useRef<HTMLDivElement>(null);

    // Keep the latest close callback without restarting the focus effect.
    useEffect(() => {
        const previousFocus = document.activeElement;
        const root = modalRef.current;

        const focusable = () => Array.from(
            root?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
                'textarea:not([disabled]), a[href], [tabindex="0"]'
            ) ?? []
        );

        focusable()[0]?.focus();

        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Tab") return;

            const elements = focusable();
            const first = elements[0];
            const last = elements[elements.length - 1];

            if (!first) {
                event.preventDefault();
                root?.focus();
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
            if (previousFocus instanceof HTMLElement) previousFocus.focus();
        };
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    return <div className="groups-overlay"
        onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={modalRef} className="groups-modal" role="dialog"
           aria-modal="true" aria-label={title} tabIndex={-1}>
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
    onCreate: (name: string, isPrivate: boolean) => Promise<Created>;
    onClose: () => void;
}) {
    const [name, setName] = useState("");
    const [access, setAccess] = useState<"private" | "public">("private");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [created, setCreated] = useState<{ id: number; code: string } | null>(null);

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (busy || !name.trim()) return;

        setBusy(true);
        setError("");

        onCreate(name.trim(), access === "private")
            .then(result => {
                if (result.invite_code)
                    setCreated({ id: result.id, code: result.invite_code });
                else
                    onClose();
            })
            .catch(error => setError(errorMessage(error)))
            .finally(() => setBusy(false));
    };

    const copy = (format: InviteFormat) => {
        if (!created) return;

        const value = format === "code"
            ? `${created.id}-${created.code}`
            : joinLink(created.id, created.code);

        navigator.clipboard.writeText(value)
            .then(() => {
                setError("");
                setNotice(format === "code" ? "Invite code copied." : "Invite link copied.");
            })
            .catch(() => setError("Could not copy. Select and copy the code below."));
    };

    if (created) {
        return <Modal title="Group created" onClose={onClose}>
          <div className="groups-modal-body">
            <p>
              Invite friends to <b>{name}</b>. Save this code or link before closing.
              It cannot currently be retrieved after reloading.
            </p>
            <code className="groups-code">{created.id}-{created.code}</code>
            <div className="groups-actions">
              <button type="button" className="groups-btn" onClick={() => copy("code")}>Copy code</button>
              <button type="button" className="groups-btn" onClick={() => copy("link")}>Copy invite link</button>
            </div>
            {notice && <p role="status" className="groups-toast">{notice}</p>}
            {error && <p role="alert" className="groups-alert">{error}</p>}
          </div>
          <div className="groups-modal-foot">
            <button type="button" className="primary" onClick={onClose}>Done</button>
          </div>
        </Modal>;
    }

    return <Modal title="Create a group" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="groups-modal-body">
          <div className="groups-label-row">
            <label htmlFor="group-name">Group name <span className="req">*</span></label>
            <span className="groups-count">{name.length}/64</span>
          </div>
          <input id="group-name" className="groups-input" value={name} maxLength={64}
                 placeholder="Enter group name" onChange={event => setName(event.target.value)}
                 required disabled={busy}/>

          <div className="groups-label-row">
            <span>Group access <span className="req">*</span></span>
          </div>
          {ACCESS.map(option => <label key={option.value}
              className={access === option.value ? "groups-option selected" : "groups-option"}>
            <input type="radio" name="group-access" checked={access === option.value}
                   onChange={() => setAccess(option.value)} disabled={busy}/>
            <span><b>{option.label}</b><small>{option.help}</small></span>
          </label>)}
          {error && <p role="alert" className="groups-alert">{error}</p>}
        </div>
        <div className="groups-modal-foot">
          <button type="submit" className="primary" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create group"}
          </button>
        </div>
      </form>
    </Modal>;
}

function JoinModal({ initialValue, invited, onJoin, onClose }: {
    initialValue: string;
    invited: { id: number; name?: string } | null;
    onJoin: (id: number, code: string) => Promise<void>;
    onClose: () => void;
}) {
    const [value, setValue] = useState(initialValue);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (busy) return;

        const parsed = invited ? { id: invited.id, code: "" } : parseJoinCode(value);
        if (!parsed) {
            setError("Paste the full invite code or invite link you were given.");
            return;
        }

        setBusy(true);
        setError("");

        onJoin(parsed.id, parsed.code)
            .then(onClose)
            .catch(error => {
                setError(errorMessage(error));
                setBusy(false);
            });
    };

    return <Modal title={invited ? "Join group" : "Join with code"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="groups-modal-body">
          {invited
            ? <p>You have been invited to join <b>{invited.name ?? "this group"}</b>.</p>
            : <>
                <div className="groups-label-row">
                  <label htmlFor="join-code">Invite code or link</label>
                </div>
                <input id="join-code" className="groups-input" value={value}
                       onChange={event => setValue(event.target.value)}
                       placeholder="Paste your invite code or link" required disabled={busy}/>
              </>}
          {error && <p role="alert" className="groups-alert">{error}</p>}
        </div>
        <div className="groups-modal-foot">
          <button type="submit" className="primary" disabled={busy || (!invited && !value.trim())}>
            {busy ? "Joining…" : "Join group"}
          </button>
        </div>
      </form>
    </Modal>;
}

function InviteButton({ group, code, onCopy }: {
    group: Group; code?: string;
    onCopy: (group: Group, code?: string, format?: InviteFormat) => void;
}) {
    if (group.is_private && !code) return null;

    return <details className="groups-menu">
      <summary className="groups-btn">Invite friends</summary>
      <div className="groups-menu-panel">
        {code && <button type="button" onClick={event => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            onCopy(group, code, "code");
        }}>Copy invite code</button>}
        <button type="button" onClick={event => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            onCopy(group, code, "link");
        }}>Copy invite link</button>
      </div>
    </details>;
}

function GroupCard({ group, invite, onOpen }: {
    group: Group; invite: ReactNode; onOpen: (settings?: boolean) => void;
}) {
    return <article className="groups-gcard">
      <div className="groups-gcard-head">
        <div className="groups-identity">
          <GroupAvatar group={group}/>
          <div>
            <button type="button" className="groups-gname" onClick={() => onOpen()}>
              {group.name}
            </button>
            <div className="groups-meta">
              <span>{group.members} members</span>
              <Badges group={group}/>
            </div>
          </div>
        </div>
        <div className="groups-actions">
          {invite}
          <button type="button" className="groups-btn groups-btn-primary" onClick={() => onOpen()}>
            View group
          </button>
        </div>
      </div>
    </article>;
}

function PublicGroupCard({ group, joined, busy, onJoin, onOpen }: {
    group?: Group; joined?: boolean; busy?: boolean;
    onJoin?: () => void; onOpen?: () => void;
}) {
    if (!group)
        return <article className="groups-pcard groups-placeholder" aria-label="Empty group slot">
          <div className="groups-pbody">
            <span className="groups-avatar" aria-hidden="true">—</span>
            <h4 className="groups-pname">Open group spot</h4>
            <p className="groups-sub">Your next community belongs here.</p>
            <button type="button" className="groups-outline" disabled>Join group</button>
          </div>
        </article>;

    return <article className="groups-pcard">
      <div className="groups-pbody">
        <GroupAvatar group={group}/>
        <h4 className="groups-pname">{group.name}</h4>
        <p className="groups-sub">{group.members} members</p>
        <button type="button" className="groups-outline" disabled={busy}
                onClick={joined ? onOpen : onJoin}>
          {busy ? "Joining…" : joined ? "View group" : "Join group"}
        </button>
      </div>
    </article>;
}

function GroupDetail({ user, group, invite, run, initialSettings, onBack }: {
    user: User; group: Group; invite: ReactNode; run: RunAction;
    initialSettings: boolean; onBack: () => void;
}) {
    const [members, setMembers] = useState<Member[]>([]);
    const [board, setBoard] = useState<Row[]>([]);
    const [period, setPeriod] = useState("week");
    const [settingsOpen, setSettingsOpen] = useState(initialSettings);
    const [membersLoading, setMembersLoading] = useState(true);
    const [boardLoading, setBoardLoading] = useState(true);
    const [membersError, setMembersError] = useState("");
    const [boardError, setBoardError] = useState("");
    const [busy, setBusy] = useState(false);
    const isOwner = !!group.is_owner;

    useEffect(() => {
        let active = true;

        const timer = window.setTimeout(() => {
            setMembersLoading(true);
            setMembersError("");

            api(user, `/groups/${group.id}/members`)
                .then(result => { if (active) setMembers(result); })
                .catch(error => { if (active) setMembersError(errorMessage(error)); })
                .finally(() => { if (active) setMembersLoading(false); });
        }, 0);

        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [user, group.id, group.members, group.is_owner]);

    useEffect(() => {
        let active = true;

        const timer = window.setTimeout(() => {
            setBoardLoading(true);
            setBoardError("");

            api(user, `/groups/${group.id}/leaderboard?period=${period}`)
                .then(result => { if (active) setBoard(result); })
                .catch(error => { if (active) setBoardError(errorMessage(error)); })
                .finally(() => { if (active) setBoardLoading(false); });
        }, 0);

        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [user, group.id, group.members, period]);

    const act = async (action: () => Promise<unknown>) => {
        if (busy) return;
        setBusy(true);
        try {
            await run(action);
        } finally {
            setBusy(false);
        }
    };

    return <div>
      <button type="button" className="groups-back" onClick={onBack}>← Back to groups</button>
      <div className="groups-detail">
        <div className="groups-detail-head">
          <div className="groups-identity">
            <GroupAvatar group={group}/>
            <div>
              <h3>{group.name}</h3>
              <div className="groups-meta">
                <span>{group.members} members</span>
                <Badges group={group}/>
              </div>
            </div>
          </div>
          <div className="groups-actions">
            {invite}
            {isOwner
              ? <button type="button" className="groups-btn" aria-expanded={settingsOpen}
                        aria-controls="group-owner-settings"
                        onClick={() => setSettingsOpen(open => !open)}>
                  {settingsOpen ? "Close settings" : "Settings"}
                </button>
              : <button type="button" className="groups-btn" disabled={busy}
                        onClick={() => void act(async () => {
                            await api(user, `/groups/${group.id}/leave`, { method: "POST" });
                            onBack();
                        })}>Leave group</button>}
          </div>
        </div>

        {isOwner && settingsOpen && <div id="group-owner-settings" className="groups-settings">
          <div>
            <h4 className="groups-subhead">Owner settings</h4>
            <p className="groups-muted">
              Manage members below. Transfer ownership before leaving,
              or delete the group for everyone.
            </p>
          </div>
          <button type="button" className="groups-btn danger" disabled={busy} onClick={() => {
              if (window.confirm(`Delete "${group.name}" for everyone? This cannot be undone.`))
                  void act(async () => {
                      await api(user, `/groups/${group.id}`, { method: "DELETE" });
                      onBack();
                  });
          }}>Delete group</button>
        </div>}

        <div className="groups-section">
          <h4 className="groups-subhead">Leaderboard</h4>
          <div className="groups-seg" role="group" aria-label="Leaderboard period">
            {["week", "month", "all"].map(value =>
              <button key={value} type="button" aria-pressed={value === period}
                      onClick={() => {
                          if (value !== period) {
                              setBoardLoading(true);
                              setPeriod(value);
                          }
                      }}>
                {value === "all" ? "All time" : value}
              </button>)}
          </div>
          <p className="groups-muted">Ranked by trading profit for the selected period.</p>
          {boardLoading
            ? <p className="groups-muted" role="status">Loading leaderboard…</p>
            : boardError
              ? <p className="groups-alert" role="alert">{boardError}</p>
              : board.length === 0
                ? <p className="groups-muted">No ranked players yet.</p>
                : <table className="groups-table">
                    <thead><tr>
                      <th scope="col">Rank</th>
                      <th scope="col">Player</th>
                      <th scope="col">Trading profit (♪)</th>
                    </tr></thead>
                    <tbody>{board.map(row => <tr key={row.user_id}>
                      <td>#{row.rank}</td>
                      <td>{row.name}</td>
                      <td className="groups-profit">
                        {row.pnl > 0 ? "+" : ""}{row.pnl.toLocaleString()} ♪
                      </td>
                    </tr>)}</tbody>
                  </table>}
        </div>

        <div className="groups-section">
          <h4 className="groups-subhead">Members</h4>
          {membersLoading
            ? <p className="groups-muted" role="status">Loading members…</p>
            : membersError
              ? <p className="groups-alert" role="alert">{membersError}</p>
              : <ul className="groups-members">{members.map(member =>
                  <li key={member.user_id} className="groups-member">
                    <span>
                      {member.name}
                      {member.is_owner && <span className="groups-badge owner"
                          style={{ marginLeft: 8 }}>Owner</span>}
                    </span>
                    {isOwner && settingsOpen && !member.is_owner &&
                      <span className="groups-actions">
                        <button type="button" className="groups-btn" disabled={busy} onClick={() => {
                            if (window.confirm(`Make ${member.name} the owner? You will lose owner controls.`))
                                void act(() => api(user, `/groups/${group.id}/owner`, {
                                    method: "POST",
                                    body: JSON.stringify({ user_id: member.user_id }),
                                }));
                        }}>Make owner</button>
                        <button type="button" className="groups-btn danger" disabled={busy} onClick={() => {
                            if (window.confirm(`Remove ${member.name} from this group?`))
                                void act(() => api(
                                    user,
                                    `/groups/${group.id}/members/${member.user_id}/remove`,
                                    { method: "POST" }
                                ));
                        }}>Remove</button>
                      </span>}
                  </li>)}</ul>}
        </div>
      </div>
    </div>;
}

// Keep account-specific state isolated when the signed-in user changes.
export function GroupsView({ user, onSignUp }: {
    user: User | null; onSignUp: () => void;
}) {
    if (!user)
        return <section className="market-section">
          <div className="live-empty">
            Sign up or log in to create or join a group.{" "}
            <button type="button" className="text-button" onClick={onSignUp}>Sign up</button>
          </div>
        </section>;

    return <SignedInGroups key={user.uid} user={user}/>;
}

function SignedInGroups({ user }: { user: User }) {
    const [groups, setGroups] = useState<Group[]>([]);
    const [groupsLoaded, setGroupsLoaded] = useState(false);
    const [publicGroups, setPublicGroups] = useState<Group[]>([]);
    const [publicLoaded, setPublicLoaded] = useState(false);
    const [publicError, setPublicError] = useState("");
    const [selected, setSelected] = useState<number | null>(null);
    const [openSettings, setOpenSettings] = useState(false);
    const [query, setQuery] = useState("");
    const [browsing, setBrowsing] = useState(false);
    const [visibleCount, setVisibleCount] = useState(12);
    const [joiningID, setJoiningID] = useState<number | null>(null);
    const [codes, setCodes] = useState<Record<number, string>>({});
    const [message, setMessage] = useState("");
    const [notice, setNotice] = useState("");

    const [prefill, setPrefill] = useState(() => ({
        id: Number(urlParam("join")) || 0,
        code: urlParam("code"),
    }));
    const [modal, setModal] = useState<"create" | "join" | null>(
        () => validID(Number(urlParam("join"))) ? "join" : null
    );

    const refresh = async () => {
        const result: Group[] = await api(user, "/me/groups");
        setGroups(result);
        setGroupsLoaded(true);
    };

    useEffect(() => {
        let active = true;

        api(user, "/me/groups")
            .then(result => {
                if (!active) return;
                setGroups(result);
                setGroupsLoaded(true);
            })
            .catch(error => { if (active) setMessage(errorMessage(error)); });

        return () => { active = false; };
    }, [user]);

    useEffect(() => {
        let active = true;
        const controller = new AbortController();

        const timer = window.setTimeout(() => {
            setPublicLoaded(false);
            setPublicError("");

            api(user, `/groups?search=${encodeURIComponent(query.trim())}`, {
                signal: controller.signal,
            })
                .then(result => {
                    if (!active) return;
                    setPublicGroups(result);
                    setPublicLoaded(true);
                })
                .catch(error => {
                    if (!active || error?.name === "AbortError") return;
                    setPublicError(errorMessage(error));
                    setPublicLoaded(true);
                });
        }, query.trim() ? 250 : 0);

        return () => {
            active = false;
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [user, query, groups]);

    const run: RunAction = async action => {
        setMessage("");
        setNotice("");

        try {
            await action();
            await refresh();
        } catch (error) {
            setMessage(errorMessage(error));
        }
    };

    const createGroup = async (name: string, isPrivate: boolean): Promise<Created> => {
        const result: Created = await api(user, "/groups", {
            method: "POST",
            body: JSON.stringify({ name, is_private: isPrivate }),
        });

        const code = result.invite_code;
        if (code) setCodes(current => ({ ...current, [result.id]: code }));

        // Return the invite even if refreshing the list fails.
        try {
            await refresh();
        } catch {
            setMessage("Group created, but the list could not refresh. Save your invite before reloading.");
        }

        return result;
    };

    const joinGroup = async (id: number, code = "") => {
        await api(user, `/groups/${id}/join`, {
            method: "POST",
            body: JSON.stringify({ code }),
        });

        try {
            await refresh();
            setOpenSettings(false);
            setSelected(id);
        } catch {
            setMessage("You joined the group, but the list could not refresh. Reload to see it.");
        }
    };

    const joinPublicGroup = async (id: number) => {
        if (joiningID !== null) return;
        setJoiningID(id);
        setMessage("");

        try {
            await joinGroup(id);
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            setJoiningID(null);
        }
    };

    const closeJoin = () => {
        setModal(null);
        setPrefill({ id: 0, code: "" });

        const url = new URL(window.location.href);
        url.searchParams.delete("join");
        url.searchParams.delete("code");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    };

    const copyInvite = (group: Group, code?: string, format: InviteFormat = "link") => {
        const value = format === "code" && code
            ? `${group.id}-${code}`
            : joinLink(group.id, code);

        navigator.clipboard.writeText(value)
            .then(() => {
                setMessage("");
                setNotice(format === "code" ? "Invite code copied." : "Invite link copied.");
            })
            .catch(() => setMessage("Could not copy. Please try again."));
    };

    const openGroup = (id: number, settings = false) => {
        setOpenSettings(settings);
        setSelected(id);
        setMessage("");
        setNotice("");
    };

    const current = groups.find(group => group.id === selected);
    const invite = (group: Group) =>
        <InviteButton group={group} code={codes[group.id]} onCopy={copyInvite}/>;

    const invited = validID(prefill.id) && !prefill.code
        ? { id: prefill.id, name: publicGroups.find(group => group.id === prefill.id)?.name }
        : null;

    const initialValue = validID(prefill.id) && prefill.code
        ? `${prefill.id}-${prefill.code}`
        : "";

    // Sort the results returned by the current API by member count.
    const sortedPublicGroups = [...publicGroups].sort(
        (a, b) => b.members - a.members || a.name.localeCompare(b.name) || a.id - b.id
    );
    const displayedPublicGroups = sortedPublicGroups.slice(0, browsing ? visibleCount : 6);
    const placeholderCount = publicLoaded && !publicError && !browsing && !query.trim()
        ? Math.max(0, 6 - displayedPublicGroups.length)
        : 0;

    return <section className="market-section">
      {message && <p role="alert" className="groups-alert">{message}</p>}
      {notice && <p role="status" className="groups-toast">{notice}</p>}

      {current
        ? <GroupDetail key={current.id} user={user} group={current} invite={invite(current)}
                       run={run} initialSettings={openSettings}
                       onBack={() => { setSelected(null); setOpenSettings(false); }}/>
        : <>
            {!browsing && <>
              <div className="groups-hero">
                <div className="groups-hero-top">
                  <div>
                    <span className="eyebrow">COMPETE WITH FRIENDS</span>
                    <h2>Groups<span className="purple-dot">.</span></h2>
                    <p>Find your community or create a competition of your own.</p>
                  </div>
                </div>
                <div className="groups-cta">
                  <span>Start a group and invite your friends.</span>
                  <div className="groups-actions">
                    <button type="button" className="groups-btn" onClick={() => {
                        setPrefill({ id: 0, code: "" });
                        setModal("join");
                    }}>Join with code</button>
                    <button type="button" className="primary small"
                            onClick={() => setModal("create")}>Create group</button>
                  </div>
                </div>
              </div>

              <h3 className="groups-subhead">My Groups</h3>
              {!groupsLoaded
                ? <p className="groups-muted groups-empty" role="status">Loading your groups…</p>
                : groups.length === 0
                  ? <div className="live-empty groups-empty">You are not in any groups yet.</div>
                  : <div className="groups-list">{groups.map(group =>
                      <GroupCard key={group.id} group={group} invite={invite(group)}
                                 onOpen={settings => openGroup(group.id, settings)}/>
                    )}</div>}
            </>}

            <div className="groups-discover">
              {browsing && <button type="button" className="groups-back" onClick={() => {
                  setBrowsing(false);
                  setQuery("");
                  setVisibleCount(12);
                  setPublicLoaded(false);
              }}>← Back to my groups</button>}

              <div className="groups-discover-head">
                <div>
                  <h3 className="groups-subhead">
                    {browsing ? "Browse public groups" : "Discover groups"}
                  </h3>
                  <p className="groups-muted">Explore communities, ordered by member count.</p>
                </div>
                {!browsing && <button type="button" className="groups-btn" onClick={() => {
                    setBrowsing(true);
                    setVisibleCount(12);
                }}>See all groups →</button>}
              </div>

              <label className="groups-search">
                <span aria-hidden="true">⌕</span>
                <input value={query} onChange={event => {
                    setQuery(event.target.value);
                    setVisibleCount(12);
                    setPublicLoaded(false);
                }} placeholder="Search public groups" aria-label="Search public groups"/>
              </label>

              {!publicLoaded
                ? <p className="groups-muted" role="status">Loading groups…</p>
                : publicError
                  ? <p className="groups-alert" role="alert">{publicError}</p>
                  : <>
                      <div className="groups-grid">
                        {displayedPublicGroups.map(group =>
                          <PublicGroupCard key={group.id} group={group}
                              joined={groups.some(mine => mine.id === group.id)}
                              busy={joiningID === group.id}
                              onJoin={() => void joinPublicGroup(group.id)}
                              onOpen={() => openGroup(group.id)}/>
                        )}
                        {Array.from({ length: placeholderCount }, (_, index) =>
                          <PublicGroupCard key={`placeholder-${index}`}/>
                        )}
                      </div>
                      {displayedPublicGroups.length === 0 && placeholderCount === 0 &&
                        <div className="live-empty">
                          {query.trim()
                            ? "No public groups match your search."
                            : "No public groups are available yet."}
                        </div>}
                      {browsing && sortedPublicGroups.length > visibleCount &&
                        <button type="button" className="groups-btn"
                                onClick={() => setVisibleCount(count => count + 12)}>
                          Show more groups
                        </button>}
                    </>}
            </div>
          </>}

      {modal === "create" &&
        <CreateGroupModal onCreate={createGroup} onClose={() => setModal(null)}/>}
      {modal === "join" &&
        <JoinModal initialValue={initialValue} invited={invited}
                   onJoin={joinGroup} onClose={closeJoin}/>}
    </section>;
}