"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { User } from "firebase/auth";
import { Lock, Search } from "lucide-react";

type Group = {
  id: number;
  name: string;
  members: number;
  is_private?: boolean;
  is_owner?: boolean;
  invite_code?: string;
};
type Member = { user_id: number; name: string; is_owner: boolean };
type Row = { rank: number; user_id: number; name: string; pnl: number };
type Created = { id: number; invite_code?: string };
type RunAction = (action: () => Promise<unknown>) => Promise<void>;
type InviteFormat = "code" | "link";

const gBtnFocus =
  "focus-visible:outline-[3px] focus-visible:outline-[#c9b7e1] focus-visible:outline-offset-[3px]";
const gBtnBase = `inline-flex min-h-[40px] cursor-pointer items-center justify-center gap-2 rounded-[9px] border px-4 py-[10px] text-[12px] font-semibold leading-[1.3] no-underline transition-[background,border-color,box-shadow] duration-150 ease-in-out disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${gBtnFocus}`;
const gBtn = `${gBtnBase} border-[#dcd8e3] bg-surface text-[#51475f] hover:border-[#bfb0d2] hover:bg-[#f2eef7]`;
const gBtnPrimary = `${gBtnBase} border-purple-dark bg-purple-dark text-white hover:border-[#5d477b] hover:bg-[#5d477b]`;
const gBtnDanger = `${gBtnBase} border-danger-line bg-surface text-danger hover:border-[#d5a49b] hover:bg-[#fdf0ed]`;
const gInput =
  "w-full rounded-[5px] border border-line bg-surface-alt px-3 py-[11px] text-[13px] text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-[#b29acb] focus-visible:outline-offset-2";
const gAlert =
  "mb-[18px] rounded-[9px] border border-danger-line bg-danger-bg px-4 py-3 text-[13px] text-danger";
const gToast =
  "mb-[18px] rounded-[9px] bg-mint px-4 py-3 text-[13px] text-[#3d5c4c]";
const gEmpty =
  "rounded-[9px] border border-dashed border-line p-[18px] text-[13px] text-muted";
const gSubhead = "mb-3 text-[15px] font-semibold tracking-[0.02em]";
const gMuted = "text-[12px] text-muted";
const gBack = `mb-[14px] text-[13px] font-semibold text-purple ${gBtnFocus}`;
const gBadge =
  "inline-flex items-center gap-1 rounded-full bg-[#eeece6] px-2 py-[3px] text-[10px] font-semibold text-[#666458]";
const gBadgeOwner =
  "inline-flex items-center gap-1 rounded-full bg-[#ece6f5] px-2 py-[3px] text-[10px] font-semibold text-[#5f4a85]";

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
    throw new Error(
      (await response.text()).trim() || `Request failed (${response.status}).`,
    );

  return response.status === 204 ? null : response.json();
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const urlParam = (key: string) =>
  typeof window === "undefined"
    ? ""
    : (new URLSearchParams(window.location.search).get(key) ?? "");

const validID = (id: number) => Number.isSafeInteger(id) && id > 0;

const joinLink = (id: number, code?: string) =>
  `${window.location.origin}/?join=${id}${code ? `&code=${encodeURIComponent(code)}` : ""}`;

const BANNERS = [
  "#292e29",
  "#8d75b4",
  "#3d5c4c",
  "#5f4a85",
  "#414b40",
  "#a8743f",
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "?";

function parseJoinCode(value: string): { id: number; code: string } | null {
  const text = value.trim();

  try {
    const url = new URL(text);
    const id = Number(url.searchParams.get("join"));
    const code = url.searchParams.get("code") ?? "";

    if (["http:", "https:"].includes(url.protocol) && validID(id))
      return { id, code };
  } catch {}

  const match = text.match(/^(\d+)-(\S+)$/);
  if (!match) return null;

  const id = Number(match[1]);
  return validID(id) ? { id, code: match[2] } : null;
}

function GroupAvatar({
  group,
  large = false,
}: {
  group: Group;
  large?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-[0.04em] text-white ${
        large ? "mb-[6px] h-16 w-16 text-[21px]" : "h-[52px] w-[52px] text-[17px]"
      }`}
      style={{ background: BANNERS[Math.abs(group.id) % BANNERS.length] }}
      aria-hidden="true"
    >
      {initials(group.name)}
    </span>
  );
}

function Badges({ group }: { group: Group }) {
  return (
    <>
      {group.is_private && (
        <span className={gBadge}>
          <Lock size={12} aria-hidden="true" />
          Private
        </span>
      )}
      {group.is_owner && <span className={gBadgeOwner}>Owner</span>}
    </>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-auto max-h-[90vh] w-[min(500px,calc(100%-32px))] overflow-y-auto rounded-[12px] border-0 bg-surface p-0 text-ink shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="relative border-b border-line px-12 py-4 text-center">
        <h3 className="text-[17px] font-semibold">{title}</h3>
        <button
          type="button"
          className="absolute right-[14px] top-1/2 -translate-y-1/2 px-2 py-1 text-[24px] leading-none text-muted"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

const ACCESS = [
  {
    value: "private",
    label: "Private",
    help: "Play with only people you invite to join.",
  },
  {
    value: "public",
    label: "Public",
    help: "Play with anyone who chooses to join.",
  },
] as const;

function CreateGroupModal({
  onCreate,
  onClose,
}: {
  onCreate: (name: string, isPrivate: boolean) => Promise<Created>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"private" | "public">("private");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: number; code: string } | null>(
    null,
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim()) return;

    setBusy(true);
    setError("");

    onCreate(name.trim(), access === "private")
      .then((result) => {
        if (result.invite_code)
          setCreated({ id: result.id, code: result.invite_code });
        else onClose();
      })
      .catch((error) => setError(errorMessage(error)))
      .finally(() => setBusy(false));
  };

  const copy = (format: InviteFormat) => {
    if (!created) return;

    const value =
      format === "code"
        ? `${created.id}-${created.code}`
        : joinLink(created.id, created.code);

    navigator.clipboard
      .writeText(value)
      .then(() => {
        setError("");
        setNotice(
          format === "code" ? "Invite code copied." : "Invite link copied.",
        );
      })
      .catch(() => setError("Could not copy. Select and copy the code below."));
  };

  if (created) {
    return (
      <Modal title="Group created" onClose={onClose}>
        <div className="flex flex-col gap-[10px] px-5 py-[18px] text-[13px]">
          <p>
            Invite friends to <b>{name}</b> using this code or link.
          </p>
          <code className="block break-all rounded-[6px] border border-line bg-surface-alt p-3 text-center font-mono">
            {created.id}-{created.code}
          </code>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={gBtn} onClick={() => copy("code")}>
              Copy code
            </button>
            <button type="button" className={gBtn} onClick={() => copy("link")}>
              Copy invite link
            </button>
          </div>
          {notice && (
            <p role="status" className={gToast}>
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className={gAlert}>
              {error}
            </p>
          )}
        </div>
        <div className="border-t border-line px-5 pb-[18px] pt-[14px]">
          <button
            type="button"
            className={`${gBtnPrimary} w-full`}
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Create a group" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="flex flex-col gap-[10px] px-5 py-[18px] text-[13px]">
          <div className="mt-[6px] flex items-baseline justify-between text-[13px] font-semibold">
            <label htmlFor="group-name">
              Group name <span className="text-danger">*</span>
            </label>
            <span className="text-[12px] font-normal text-muted">
              {name.length}/64
            </span>
          </div>
          <input
            id="group-name"
            className={gInput}
            value={name}
            maxLength={64}
            placeholder="Enter group name"
            onChange={(event) => setName(event.target.value)}
            required
            disabled={busy}
          />

          <div className="mt-[6px] flex items-baseline justify-between text-[13px] font-semibold">
            <span>
              Group access <span className="text-danger">*</span>
            </span>
          </div>
          {ACCESS.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-[8px] ${
                access === option.value
                  ? "border-2 border-purple bg-[#f3effa] px-[13px] py-[11px]"
                  : "border border-line px-[14px] py-3"
              }`}
            >
              <input
                type="radio"
                name="group-access"
                className="mt-[3px] accent-purple"
                checked={access === option.value}
                onChange={() => setAccess(option.value)}
                disabled={busy}
              />
              <span>
                <b className="block text-[14px]">{option.label}</b>
                <small className="text-[12px] text-muted">{option.help}</small>
              </span>
            </label>
          ))}
          {error && (
            <p role="alert" className={gAlert}>
              {error}
            </p>
          )}
        </div>
        <div className="border-t border-line px-5 pb-[18px] pt-[14px]">
          <button
            type="submit"
            className={`${gBtnPrimary} w-full`}
            disabled={busy || !name.trim()}
          >
            {busy ? "Creating…" : "Create group"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function JoinModal({
  initialValue,
  invited,
  onJoin,
  onClose,
}: {
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

    const parsed = invited
      ? { id: invited.id, code: "" }
      : parseJoinCode(value);
    if (!parsed) {
      setError("Paste the full invite code or invite link you were given.");
      return;
    }

    setBusy(true);
    setError("");

    onJoin(parsed.id, parsed.code)
      .then(onClose)
      .catch((error) => {
        setError(errorMessage(error));
        setBusy(false);
      });
  };

  return (
    <Modal title={invited ? "Join group" : "Join with code"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="flex flex-col gap-[10px] px-5 py-[18px] text-[13px]">
          {invited ? (
            <p>
              You have been invited to join{" "}
              <b>{invited.name ?? "this group"}</b>.
            </p>
          ) : (
            <>
              <div className="mt-[6px] flex items-baseline justify-between text-[13px] font-semibold">
                <label htmlFor="join-code">Invite code or link</label>
              </div>
              <input
                id="join-code"
                className={gInput}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="Paste your invite code or link"
                required
                disabled={busy}
              />
            </>
          )}
          {error && (
            <p role="alert" className={gAlert}>
              {error}
            </p>
          )}
        </div>
        <div className="border-t border-line px-5 pb-[18px] pt-[14px]">
          <button
            type="submit"
            className={`${gBtnPrimary} w-full`}
            disabled={busy || (!invited && !value.trim())}
          >
            {busy ? "Joining…" : "Join group"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function InviteButton({
  group,
  code,
  onCopy,
}: {
  group: Group;
  code?: string;
  onCopy: (group: Group, code?: string, format?: InviteFormat) => void;
}) {
  if (!group.is_private)
    return (
      <button
        type="button"
        className={gBtn}
        onClick={() => onCopy(group, undefined, "link")}
      >
        Invite friends
      </button>
    );

  if (!code) return null;

  return (
    <details className="group relative">
      <summary
        className={`${gBtn} list-none group-open:border-[#bfb0d2] group-open:bg-[#f2eef7]`}
      >
        Invite friends
      </summary>
      <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-[190px] rounded-[10px] border border-line bg-surface p-[5px] shadow-[0_10px_30px_#25272318] max-[580px]:left-0 max-[580px]:right-auto">
        <button
          type="button"
          className={`block w-full cursor-pointer rounded-[6px] border-0 bg-transparent px-3 py-[11px] text-left text-[12px] text-ink hover:bg-[#f2eef7] ${gBtnFocus}`}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            onCopy(group, code, "code");
          }}
        >
          Copy invite code
        </button>
        <button
          type="button"
          className={`block w-full cursor-pointer rounded-[6px] border-0 bg-transparent px-3 py-[11px] text-left text-[12px] text-ink hover:bg-[#f2eef7] ${gBtnFocus}`}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            onCopy(group, code, "link");
          }}
        >
          Copy invite link
        </button>
      </div>
    </details>
  );
}

function GroupCard({
  group,
  invite,
  onOpen,
}: {
  group: Group;
  invite: ReactNode;
  onOpen: () => void;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-[1_1_220px] items-center gap-[14px]">
          <GroupAvatar group={group} />
          <div className="min-w-0">
            <button
              type="button"
              className={`border-0 bg-transparent p-0 text-left text-[17px] font-semibold leading-[1.4] tracking-[-0.3px] text-ink [overflow-wrap:anywhere] hover:text-purple-dark ${gBtnFocus}`}
              onClick={() => onOpen()}
            >
              {group.name}
            </button>
            <div className="mt-[5px] flex flex-wrap items-center gap-[7px] text-[12px] text-muted">
              <span>{group.members} members</span>
              <Badges group={group} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 max-[580px]:w-full max-[580px]:[&>button]:flex-1">
          {invite}
          <button
            type="button"
            className={gBtnPrimary}
            onClick={() => onOpen()}
          >
            View group
          </button>
        </div>
      </div>
    </article>
  );
}

function PublicGroupCard({
  group,
  joined,
  busy,
  onJoin,
  onOpen,
}: {
  group: Group;
  joined?: boolean;
  busy?: boolean;
  onJoin?: () => void;
  onOpen?: () => void;
}) {
  return (
    <article className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex flex-1 flex-col items-center gap-2 px-[18px] pb-[18px] pt-6 text-center">
        <GroupAvatar group={group} large />
        <h4 className="text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">
          {group.name}
        </h4>
        <p className="mb-3 text-[12px] text-muted">{group.members} members</p>
        <button
          type="button"
          className={`${gBtn} mt-auto w-full`}
          disabled={busy}
          onClick={joined ? onOpen : onJoin}
        >
          {busy ? "Joining…" : joined ? "View group" : "Join group"}
        </button>
      </div>
    </article>
  );
}

function GroupDetail({
  user,
  group,
  invite,
  run,
  onBack,
}: {
  user: User;
  group: Group;
  invite: ReactNode;
  run: RunAction;
  onBack: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [board, setBoard] = useState<Row[]>([]);
  const [period, setPeriod] = useState("week");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [membersLoading, setMembersLoading] = useState(true);
  const [boardLoading, setBoardLoading] = useState(true);
  const [membersError, setMembersError] = useState("");
  const [boardError, setBoardError] = useState("");
  const [busy, setBusy] = useState(false);
  const isOwner = !!group.is_owner;

  useEffect(() => {
    let active = true;

    api(user, `/groups/${group.id}/members`)
      .then((result) => {
        if (active) {
          setMembers(result);
          setMembersError("");
        }
      })
      .catch((error) => {
        if (active) setMembersError(errorMessage(error));
      })
      .finally(() => {
        if (active) setMembersLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user, group.id, group.members, group.is_owner]);

  useEffect(() => {
    let active = true;

    api(user, `/groups/${group.id}/leaderboard?period=${period}`)
      .then((result) => {
        if (active) {
          setBoard(result);
          setBoardError("");
        }
      })
      .catch((error) => {
        if (active) setBoardError(errorMessage(error));
      })
      .finally(() => {
        if (active) setBoardLoading(false);
      });

    return () => {
      active = false;
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

  return (
    <div>
      <button type="button" className={gBack} onClick={onBack}>
        ← Back to groups
      </button>
      <div className="flex flex-col gap-6 rounded-[9px] border border-line bg-surface p-5 max-[580px]:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-[1_1_220px] items-center gap-[14px]">
            <GroupAvatar group={group} />
            <div className="min-w-0">
              <h3 className="text-[22px] font-medium tracking-[-0.5px]">
                {group.name}
              </h3>
              <div className="mt-[5px] flex flex-wrap items-center gap-[7px] text-[12px] text-muted">
                <span>{group.members} members</span>
                <Badges group={group} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {invite}
            {isOwner ? (
              <button
                type="button"
                className={gBtn}
                aria-expanded={settingsOpen}
                aria-controls="group-owner-settings"
                onClick={() => setSettingsOpen((open) => !open)}
              >
                {settingsOpen ? "Close settings" : "Settings"}
              </button>
            ) : (
              <button
                type="button"
                className={gBtn}
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api(user, `/groups/${group.id}/leave`, {
                      method: "POST",
                    });
                    onBack();
                  })
                }
              >
                Leave group
              </button>
            )}
          </div>
        </div>

        {isOwner && settingsOpen && (
          <div
            id="group-owner-settings"
            className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-[#ded5e9] bg-[#f7f3fb] p-4"
          >
            <div className="flex-[1_1_220px]">
              <h4 className="mb-[6px] text-[15px] font-semibold tracking-[0.02em]">
                Owner settings
              </h4>
              <p className="text-[12px] leading-[1.6] text-muted">
                Manage members below. Transfer ownership before leaving, or
                delete the group for everyone.
              </p>
            </div>
            <button
              type="button"
              className={gBtnDanger}
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete "${group.name}" for everyone? This cannot be undone.`,
                  )
                )
                  void act(async () => {
                    await api(user, `/groups/${group.id}`, {
                      method: "DELETE",
                    });
                    onBack();
                  });
              }}
            >
              Delete group
            </button>
          </div>
        )}

        <div className="flex flex-col gap-[10px]">
          <h4 className={gSubhead}>Leaderboard</h4>
          <div
            className="inline-flex self-start overflow-hidden rounded-[7px] border border-line"
            role="group"
            aria-label="Leaderboard period"
          >
            {["week", "month", "all"].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={value === period}
                className={`px-[14px] py-2 text-[12px] font-semibold ${gBtnFocus} ${
                  value === period
                    ? "bg-ink-strong text-white"
                    : "bg-surface-alt"
                }`}
                onClick={() => {
                  if (value !== period) {
                    setBoardLoading(true);
                    setPeriod(value);
                  }
                }}
              >
                {value === "all" ? "All time" : value}
              </button>
            ))}
          </div>
          <p className={gMuted}>
            Ranked by trading profit for the selected period.
          </p>
          {boardLoading ? (
            <p className={gMuted} role="status">
              Loading leaderboard…
            </p>
          ) : boardError ? (
            <p className={gAlert} role="alert">
              {boardError}
            </p>
          ) : board.length === 0 ? (
            <p className={gMuted}>No ranked players yet.</p>
          ) : (
            <table className="w-full table-fixed border-collapse text-[13px] tabular-nums">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="w-[56px] border-b border-line py-3 pl-0 pr-2 text-left text-[10px] uppercase tracking-[0.08em] text-muted [overflow-wrap:anywhere]"
                  >
                    Rank
                  </th>
                  <th
                    scope="col"
                    className="border-b border-line px-2 py-3 text-left text-[10px] uppercase tracking-[0.08em] text-muted [overflow-wrap:anywhere]"
                  >
                    Player
                  </th>
                  <th
                    scope="col"
                    className="border-b border-line py-3 pl-2 pr-0 text-right text-[10px] uppercase tracking-[0.08em] text-muted [overflow-wrap:anywhere]"
                  >
                    Trading profit (♪)
                  </th>
                </tr>
              </thead>
              <tbody>
                {board.map((row) => (
                  <tr key={row.user_id}>
                    <td className="w-[56px] border-b border-line py-3 pl-0 pr-2 [overflow-wrap:anywhere]">
                      #{row.rank}
                    </td>
                    <td className="border-b border-line px-2 py-3 [overflow-wrap:anywhere]">
                      {row.name}
                    </td>
                    <td className="whitespace-nowrap border-b border-line py-3 pl-2 pr-0 text-right font-semibold text-ink">
                      {row.pnl > 0 ? "+" : ""}
                      {row.pnl.toLocaleString()} ♪
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-col gap-[10px]">
          <h4 className={gSubhead}>Members</h4>
          {membersLoading ? (
            <p className={gMuted} role="status">
              Loading members…
            </p>
          ) : membersError ? (
            <p className={gAlert} role="alert">
              {membersError}
            </p>
          ) : (
            <ul className="m-0 list-none p-0">
              {members.map((member) => (
                <li
                  key={member.user_id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-[10px] text-[13px] first:border-t-0"
                >
                  <span>
                    {member.name}
                    {member.is_owner && (
                      <span className={`${gBadgeOwner} ml-2`}>Owner</span>
                    )}
                  </span>
                  {isOwner && settingsOpen && !member.is_owner && (
                    <span className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={gBtn}
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Make ${member.name} the owner? You will lose owner controls.`,
                            )
                          )
                            void act(() =>
                              api(user, `/groups/${group.id}/owner`, {
                                method: "POST",
                                body: JSON.stringify({
                                  user_id: member.user_id,
                                }),
                              }),
                            );
                        }}
                      >
                        Make owner
                      </button>
                      <button
                        type="button"
                        className={gBtnDanger}
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove ${member.name} from this group?`,
                            )
                          )
                            void act(() =>
                              api(
                                user,
                                `/groups/${group.id}/members/${member.user_id}/remove`,
                                { method: "POST" },
                              ),
                            );
                        }}
                      >
                        Remove
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function GroupsView({
  user,
  onSignUp,
}: {
  user: User | null;
  onSignUp: () => void;
}) {
  if (!user)
    return (
      <section className="scroll-mt-5 pb-10 pt-[38px] max-[580px]:pt-[30px]">
        <div className={gEmpty}>
          Sign up or log in to create or join a group.{" "}
          <button
            type="button"
            className="inline-flex items-center gap-[9px] py-2 text-[12px]"
            onClick={onSignUp}
          >
            Sign up
          </button>
        </div>
      </section>
    );

  return <SignedInGroups key={user.uid} user={user} />;
}

function SignedInGroups({ user }: { user: User }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [publicGroups, setPublicGroups] = useState<Group[]>([]);
  const [publicLoaded, setPublicLoaded] = useState(false);
  const [publicError, setPublicError] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
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
  const [modal, setModal] = useState<"create" | "join" | null>(() =>
    validID(Number(urlParam("join"))) ? "join" : null,
  );

  const refresh = async () => {
    const result: Group[] = await api(user, "/me/groups");
    setGroups(result);
    setGroupsLoaded(true);
  };

  useEffect(() => {
    let active = true;

    api(user, "/me/groups")
      .then((result) => {
        if (!active) return;
        setGroups(result);
        setGroupsLoaded(true);
      })
      .catch((error) => {
        if (active) {
          setMessage(errorMessage(error));
          setGroupsLoaded(true);
        }
      });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const load = () => {
      api(user, `/groups?search=${encodeURIComponent(query.trim())}`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (!active) return;
          setPublicGroups(result);
          setPublicError("");
          setPublicLoaded(true);
        })
        .catch((error) => {
          if (!active || error?.name === "AbortError") return;
          setPublicError(errorMessage(error));
          setPublicLoaded(true);
        });
    };

    const timer = query.trim() ? window.setTimeout(load, 250) : null;
    if (!timer) load();

    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      controller.abort();
    };
  }, [user, query]);

  const run: RunAction = async (action) => {
    setMessage("");
    setNotice("");

    try {
      await action();
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const createGroup = async (
    name: string,
    isPrivate: boolean,
  ): Promise<Created> => {
    const result: Created = await api(user, "/groups", {
      method: "POST",
      body: JSON.stringify({ name, is_private: isPrivate }),
    });

    const code = result.invite_code;
    if (code) setCodes((current) => ({ ...current, [result.id]: code }));

    try {
      await refresh();
    } catch {
      setMessage(
        "Group created, but the list could not refresh. Save your invite before reloading.",
      );
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
      setSelected(id);
    } catch {
      setMessage(
        "You joined the group, but the list could not refresh. Reload to see it.",
      );
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
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  };

  const copyInvite = (
    group: Group,
    code?: string,
    format: InviteFormat = "link",
  ) => {
    const value =
      format === "code" && code
        ? `${group.id}-${code}`
        : joinLink(group.id, code);

    navigator.clipboard
      .writeText(value)
      .then(() => {
        setMessage("");
        setNotice(
          format === "code" ? "Invite code copied." : "Invite link copied.",
        );
      })
      .catch(() => setMessage("Could not copy. Please try again."));
  };

  const openGroup = (id: number) => {
    setSelected(id);
    setMessage("");
    setNotice("");
  };

  const current = groups.find((group) => group.id === selected);
  const invite = (group: Group) => (
    <InviteButton
      group={group}
      code={group.invite_code || codes[group.id]}
      onCopy={copyInvite}
    />
  );

  const invited =
    validID(prefill.id) && !prefill.code
      ? {
          id: prefill.id,
          name: publicGroups.find((group) => group.id === prefill.id)?.name,
        }
      : null;

  const initialValue =
    validID(prefill.id) && prefill.code ? `${prefill.id}-${prefill.code}` : "";

  const sortedPublicGroups = [...publicGroups].sort(
    (a, b) =>
      b.members - a.members || a.name.localeCompare(b.name) || a.id - b.id,
  );
  const displayedPublicGroups = sortedPublicGroups.slice(
    0,
    browsing ? visibleCount : 6,
  );

  return (
    <section className="scroll-mt-5 pb-10 pt-[38px] max-[580px]:pt-[30px]">
      {message && (
        <p role="alert" className={gAlert}>
          {message}
        </p>
      )}
      {notice && (
        <p role="status" className={gToast}>
          {notice}
        </p>
      )}

      {current ? (
        <GroupDetail
          key={current.id}
          user={user}
          group={current}
          invite={invite(current)}
          run={run}
          onBack={() => setSelected(null)}
        />
      ) : (
        <>
          {!browsing && (
            <>
              <div className="mb-[30px] flex flex-col gap-5 rounded-[12px] border border-line bg-surface px-6 py-[22px] max-[580px]:p-[18px]">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h2 className="mb-[6px] mt-[9px] text-[28px] font-medium tracking-[-1px]">
                      Groups<span className="text-purple">.</span>
                    </h2>
                    <p className="text-[13px] text-muted">
                      Find your community or create a competition of your own.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[9px] bg-surface-muted px-[18px] py-[14px] text-[13px]">
                  <span>Start a group and invite your friends.</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={gBtn}
                      onClick={() => {
                        setPrefill({ id: 0, code: "" });
                        setModal("join");
                      }}
                    >
                      Join with code
                    </button>
                    <button
                      type="button"
                      className={gBtnPrimary}
                      onClick={() => setModal("create")}
                    >
                      Create group
                    </button>
                  </div>
                </div>
              </div>

              <h3 className={gSubhead}>My Groups</h3>
              {!groupsLoaded ? (
                <p className={`${gMuted} mb-[30px]`} role="status">
                  Loading your groups…
                </p>
              ) : groups.length === 0 ? (
                <div className={`${gEmpty} mb-[30px]`}>
                  You are not in any groups yet.
                </div>
              ) : (
                <div className="mb-[30px] flex flex-col gap-[14px]">
                  {groups.map((group) => (
                    <GroupCard
                      key={group.id}
                      group={group}
                      invite={invite(group)}
                      onOpen={() => openGroup(group.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          <div className="pt-[6px]">
            {browsing && (
              <button
                type="button"
                className={gBack}
                onClick={() => {
                  setBrowsing(false);
                  setQuery("");
                  setVisibleCount(12);
                }}
              >
                ← Back to my groups
              </button>
            )}

            <div className="mb-4 flex flex-wrap items-center justify-between gap-[14px]">
              <div>
                <h3 className="mb-[5px] text-[15px] font-semibold tracking-[0.02em]">
                  {browsing ? "Browse public groups" : "Discover groups"}
                </h3>
                <p className={gMuted}>
                  Explore communities, ordered by member count.
                </p>
              </div>
              {!browsing && (
                <button
                  type="button"
                  className={gBtn}
                  onClick={() => {
                    setBrowsing(true);
                    setVisibleCount(12);
                  }}
                >
                  See all groups →
                </button>
              )}
            </div>

            <label className="mb-[18px] flex w-full items-center gap-[9px] rounded-[9px] border border-line bg-surface px-[14px] py-3 text-muted focus-within:border-purple">
              <Search size={16} aria-hidden="true" />
              <input
                className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink focus-visible:outline-none"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setVisibleCount(12);
                  setPublicLoaded(false);
                }}
                placeholder="Search public groups"
                aria-label="Search public groups"
              />
            </label>

            {!publicLoaded ? (
              <p className={gMuted} role="status">
                Loading groups…
              </p>
            ) : publicError ? (
              <p className={gAlert} role="alert">
                {publicError}
              </p>
            ) : (
              <>
                <div className="mb-5 grid grid-cols-3 gap-4 max-[850px]:grid-cols-2 max-[580px]:grid-cols-1">
                  {displayedPublicGroups.map((group) => (
                    <PublicGroupCard
                      key={group.id}
                      group={group}
                      joined={groups.some((mine) => mine.id === group.id)}
                      busy={joiningID === group.id}
                      onJoin={() => void joinPublicGroup(group.id)}
                      onOpen={() => openGroup(group.id)}
                    />
                  ))}
                </div>
                {displayedPublicGroups.length === 0 && (
                  <div className={gEmpty}>
                    {query.trim()
                      ? "No public groups match your search."
                      : "No public groups are available yet."}
                  </div>
                )}
                {browsing && sortedPublicGroups.length > visibleCount && (
                  <button
                    type="button"
                    className={gBtn}
                    onClick={() => setVisibleCount((count) => count + 12)}
                  >
                    Show more groups
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {modal === "create" && (
        <CreateGroupModal
          onCreate={createGroup}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "join" && (
        <JoinModal
          initialValue={initialValue}
          invited={invited}
          onJoin={joinGroup}
          onClose={closeJoin}
        />
      )}
    </section>
  );
}
