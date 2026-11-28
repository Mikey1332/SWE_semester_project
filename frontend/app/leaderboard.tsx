"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { formatNotes } from "./trading";
import { loadLeaderboard, type LeaderboardEntry } from "./leaderboard-data";

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
        if (!controller.signal.aborted)
          setError(
            err instanceof Error ? err.message : "Could not load the charts.",
          );
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 60000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [revision, user]);

  function name(entry: LeaderboardEntry) {
    return entry.user_id === currentUserId ? (
      <strong className="text-[16px] font-bold [overflow-wrap:anywhere] max-[580px]:text-[13px]">
        {entry.name} <small className="text-[11px]">(you)</small>
      </strong>
    ) : (
      <span className="text-[16px] font-normal [overflow-wrap:anywhere] max-[580px]:text-[13px]">
        {entry.name}
      </span>
    );
  }

  return (
    <section
      className="mx-auto w-full max-w-[1000px] scroll-mt-5 pt-[38px] pb-10 max-[580px]:pt-[30px]"
      aria-labelledby="charts-title"
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-5">
        <div>
          <p className="leading-[1.6] text-muted">
            Think your taste can help you climb the charts?
          </p>
          <h1
            id="charts-title"
            className="my-3 text-[clamp(28px,4vw,42px)] font-medium tracking-[-1.5px]"
          >
            The Octave Charts
          </h1>
          <p className="leading-[1.6] text-muted">Our Top Ten Charters</p>
        </div>
        <button
          className="inline-flex items-center justify-between gap-[25px] rounded-[7px] border border-[#b8bbae] bg-transparent px-[22px] py-[15px] text-[13px] font-semibold text-ink hover:bg-[#eeeee5]"
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh charts ↗
        </button>
      </div>
      {error && (
        <p
          className="rounded-[9px] border border-line bg-surface px-[18px] py-[14px] text-danger"
          role="alert"
        >
          {error}
        </p>
      )}
      {!entries && !error && (
        <p
          className="rounded-[9px] border border-dashed border-line p-[18px] text-[13px] text-muted"
          role="status"
        >
          Loading the charts…
        </p>
      )}
      {entries?.length === 0 && !error && (
        <p className="rounded-[9px] border border-dashed border-line p-[18px] text-[13px] text-muted">
          No profiles have synced yet. Sign in to add your profile to the
          charts.
        </p>
      )}
      {!!entries?.length && (
        <>
          <ol
            className="m-0 mb-7 grid list-none grid-cols-3 items-end gap-4 p-0 max-[580px]:gap-2"
            aria-label="Top three profiles"
          >
            {entries.slice(0, 3).map((entry) => (
              <li
                key={entry.user_id}
                value={entry.rank}
                className={`flex min-w-0 flex-col items-center gap-3 rounded-[12px] border border-line bg-surface px-3 py-7 text-center max-[580px]:gap-[10px] max-[580px]:px-2 max-[580px]:py-5 ${
                  entry.rank === 1
                    ? "col-start-2 row-start-1 pt-5"
                    : entry.rank === 2
                      ? "col-start-1 row-start-1"
                      : "col-start-3 row-start-1"
                }`}
              >
                {entry.rank === 1 && (
                  <span
                    className="text-[38px] leading-none text-purple"
                    role="img"
                    aria-label="Chart leader"
                  >
                    ♪
                  </span>
                )}
                <span
                  className="grid h-8 w-8 place-items-center rounded-full bg-mint font-semibold"
                  aria-label={"Rank " + entry.rank}
                >
                  {entry.rank}
                </span>
                {name(entry)}
                <span
                  className={`max-[580px]:text-[12px] ${entry.pnl >= 0 ? "text-up" : "text-down"}`}
                >
                  {formatNotes(entry.pnl)}
                </span>
                <small className="text-[10px] tracking-[0.08em] uppercase text-muted">
                  Total P&amp;L
                </small>
              </li>
            ))}
          </ol>
          {entries.length > 3 && (
            <ol
              className="m-0 flex list-none flex-col gap-[10px] rounded-[12px] bg-[#efeee6] p-4 max-[580px]:p-2"
              start={4}
              aria-label="Profiles ranked four to ten"
            >
              {entries.slice(3).map((entry) => (
                <li
                  key={entry.user_id}
                  className="flex items-center gap-[18px] rounded-[9px] border border-line bg-surface p-[18px] max-[580px]:gap-[10px] max-[580px]:px-[10px] max-[580px]:py-[14px]"
                >
                  <span
                    className="w-[22px] shrink-0 tabular-nums text-muted"
                    aria-label={"Rank " + entry.rank}
                  >
                    {entry.rank}
                  </span>
                  {name(entry)}
                  <span
                    className={`ml-auto whitespace-nowrap tabular-nums ${entry.pnl >= 0 ? "text-up" : "text-down"}`}
                  >
                    {formatNotes(entry.pnl)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
