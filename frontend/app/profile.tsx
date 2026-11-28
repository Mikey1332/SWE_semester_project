"use client";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  formatNotes,
  marketQuestion,
  sideLabel,
  winRatePercent,
  type ProfileData,
  type TradeSide,
} from "./trading";

const emptyBox =
  "rounded-[9px] border border-dashed border-line p-[18px] text-[13px] text-muted";
const textBtn =
  "inline-flex items-center gap-[9px] py-2 text-[12px]";
const tableWrap =
  "overflow-x-auto rounded-[9px] border border-line bg-white";
const tableClass = "w-full min-w-[860px] border-collapse text-[12px]";
const thBase =
  "whitespace-nowrap border-b border-line px-[14px] py-3 text-left text-[10px] font-medium uppercase tracking-[0.4px] text-muted";
const thNum =
  "whitespace-nowrap border-b border-line px-[14px] py-3 text-right text-[10px] font-medium uppercase tracking-[0.4px] text-muted tabular-nums";
const tdBase = "border-b border-[#f0f0ea] px-[14px] py-3 align-top";
const tdNum =
  "whitespace-nowrap border-b border-[#f0f0ea] px-[14px] py-3 text-right align-top tabular-nums";
const tdSong =
  "flex max-w-[320px] flex-col gap-[2px] border-b border-[#f0f0ea] px-[14px] py-3 align-top";
const sideBadge =
  "inline-block rounded-[4px] px-[7px] py-[3px] text-[10px] font-semibold";
const statCard =
  "flex flex-col gap-[6px] rounded-[9px] border border-line bg-surface px-5 py-[18px]";
const eyebrow =
  "inline-flex items-center gap-[10px] text-[9px] font-bold tracking-[1.6px] text-[#787c70]";

const resultBadgeStyles: Record<string, string> = {
  won: "bg-up-bg text-[#4f826a]",
  lost: "bg-down-bg text-down",
  refunded: "bg-[#eee7f6] text-[#665281]",
};

export function ProfileView({
  user,
  onSignUp,
  onOpenMarket,
}: {
  user: User | null;
  onSignUp: () => void;
  onOpenMarket: (marketId: number, side: TradeSide) => void;
}) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [error, setError] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);
  const [tab, setTab] = useState<"active" | "resolved">("active");

  async function fetchProfileData(currentUser: User) {
    const token = await currentUser.getIdToken();
    const response = await fetch("/api/me/profile", {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text.trim() || "Could not load your profile.");
    }
    return (await response.json()) as ProfileData;
  }

  useEffect(() => {
    if (!user) {
      return;
    }
    const currentUser = user;
    let current = true;

    async function loadProfile() {
      try {
        const profileData = await fetchProfileData(currentUser);
        if (current) {
          setProfile(profileData);
          setError("");
          setLoading(false);
        }
      } catch (err) {
        if (current) {
          setError(
            err instanceof Error ? err.message : "Could not load your profile.",
          );
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      current = false;
    };
  }, [user]);

  async function cancelPendingOrder(orderId: number) {
    if (!user) {
      return;
    }
    setBusyOrderId(orderId);
    setCancelError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/orders/" + orderId + "/cancel", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
      });
      if (!response.ok) {
        const text = await response.text();
        setCancelError(text.trim() || "Could not cancel order.");
        setBusyOrderId(null);
        return;
      }
      const profileData = await fetchProfileData(user);
      setProfile(profileData);
      setBusyOrderId(null);
    } catch {
      setCancelError("Could not cancel order.");
      setBusyOrderId(null);
    }
  }

  if (!user) {
    return (
      <section className="scroll-mt-5 pb-10 pt-[38px] max-[580px]:pt-[30px]">
        <div className={emptyBox}>
          Sign up or log in to view your profile, positions, P&amp;L, and
          win-loss record.{" "}
          <button className={textBtn} onClick={onSignUp}>
            Sign up →
          </button>
        </div>
      </section>
    );
  }

  let displayUsername = "My profile";
  if (user.displayName) {
    displayUsername = user.displayName;
  } else if (profile && profile.username) {
    displayUsername = profile.username;
  } else if (user.email) {
    displayUsername = user.email.split("@")[0];
  }

  if (loading) {
    return (
      <section className="scroll-mt-5 pb-10 pt-[38px] max-[580px]:pt-[30px]">
        <p className={emptyBox}>Loading your profile…</p>
      </section>
    );
  }

  if (error !== "") {
    return (
      <section className="scroll-mt-5 pb-10 pt-[38px] max-[580px]:pt-[30px]">
        <p className={emptyBox}>{error}</p>
      </section>
    );
  }

  if (!profile) {
    return null;
  }

  const activePositions = profile.active_positions || [];
  const pendingOrders = profile.pending_orders || [];
  const resolvedPositions = profile.resolved_positions || [];
  const winRate = winRatePercent(profile.wins, profile.losses);

  return (
    <section className="scroll-mt-5 pb-10 pt-[38px] max-[580px]:pt-[30px]">
      <div className="mb-[25px] flex items-end justify-between max-[580px]:mb-5 max-[580px]:flex-wrap max-[580px]:items-start max-[580px]:gap-3">
        <div>
          <span className={`${eyebrow} max-[580px]:text-[7px] max-[580px]:tracking-[1px]`}>
            PLAYER PROFILE
          </span>
          <h2 className="mt-[9px] text-[28px] font-medium tracking-[-1px] max-[850px]:text-[25px] max-[580px]:text-[23px] max-[580px]:tracking-[-0.8px]">
            {displayUsername}
            <span className="text-purple">.</span>
          </h2>
        </div>
        <span className="flex items-center gap-2 text-[10px] text-[#7e8175] max-[850px]:text-[9px]">
          Portfolio <b>♫ {profile.portfolio_value.toLocaleString()}</b> ·
          Available <b>♫ {profile.available_balance.toLocaleString()}</b>
        </span>
      </div>

      {cancelError !== "" && (
        <p className={`${emptyBox} mb-4`} role="alert">
          {cancelError}
        </p>
      )}

      <div className="mb-6 grid grid-cols-4 gap-4 max-[850px]:grid-cols-2 max-[580px]:grid-cols-1">
        <article className={statCard}>
          <span className={eyebrow}>MUSIC NOTE BALANCE</span>
          <strong className="text-[26px] font-medium tracking-[-1px] tabular-nums">
            ♫ {profile.balance.toLocaleString()}
          </strong>
          <small className="text-[11px] text-muted">
            ♫ {profile.available_balance.toLocaleString()} available
            {profile.reserved_cash > 0
              ? " · ♫ " + profile.reserved_cash.toLocaleString() + " reserved"
              : ""}
          </small>
        </article>

        <article className={statCard}>
          <span className={eyebrow}>REALIZED P&amp;L</span>
          <strong
            className={`text-[26px] font-medium tracking-[-1px] tabular-nums ${
              profile.realized_pnl >= 0 ? "text-up" : "text-[#b27068]"
            }`}
          >
            {formatNotes(profile.realized_pnl)}
          </strong>
          <small className="text-[11px] text-muted">
            From settled markets &amp; sales
          </small>
        </article>

        <article className={statCard}>
          <span className={eyebrow}>UNREALIZED P&amp;L</span>
          <strong
            className={`text-[26px] font-medium tracking-[-1px] tabular-nums ${
              profile.unrealized_pnl >= 0 ? "text-up" : "text-[#b27068]"
            }`}
          >
            {formatNotes(profile.unrealized_pnl)}
          </strong>
          <small className="text-[11px] text-muted">
            {activePositions.length} active positions
          </small>
        </article>

        <article className={statCard}>
          <span className={eyebrow}>WIN-LOSS RECORD</span>
          <strong className="text-[26px] font-medium tracking-[-1px] tabular-nums">
            {profile.wins}W – {profile.losses}L
            {profile.refunds > 0 ? " – " + profile.refunds + "R" : ""}
          </strong>
          <small className="text-[11px] text-muted">
            {winRate !== null
              ? winRate + "% win rate"
              : "No settled positions yet"}
          </small>
        </article>
      </div>

      <div
        className="mb-[18px] flex flex-wrap items-center gap-1 max-[580px]:gap-[2px]"
        role="group"
        aria-label="Position tabs"
      >
        <button
          aria-pressed={tab === "active"}
          className={`whitespace-nowrap rounded-[5px] px-3 py-[9px] text-[11px] max-[580px]:px-[10px] max-[580px]:py-2 max-[580px]:text-[10px] ${
            tab === "active"
              ? "bg-[#2e332c] text-white"
              : "text-[#7d8075]"
          }`}
          onClick={() => setTab("active")}
        >
          Active positions ({activePositions.length + pendingOrders.length})
        </button>
        <button
          aria-pressed={tab === "resolved"}
          className={`whitespace-nowrap rounded-[5px] px-3 py-[9px] text-[11px] max-[580px]:px-[10px] max-[580px]:py-2 max-[580px]:text-[10px] ${
            tab === "resolved"
              ? "bg-[#2e332c] text-white"
              : "text-[#7d8075]"
          }`}
          onClick={() => setTab("resolved")}
        >
          Past positions ({resolvedPositions.length})
        </button>
      </div>

      {tab === "active" &&
        activePositions.length === 0 &&
        pendingOrders.length === 0 && (
          <p className={emptyBox}>
            No active positions or pending orders yet. Buy contracts on the
            Discover tab.
          </p>
        )}

      {tab === "active" && activePositions.length > 0 && (
        <div className={tableWrap}>
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={thBase}>Song</th>
                <th className={thBase}>Chart Date</th>
                <th className={thBase}>Side</th>
                <th className={thNum}>Contracts</th>
                <th className={thNum}>Cost Basis</th>
                <th className={thNum}>Current Price</th>
                <th className={thNum}>Market Value</th>
                <th className={thNum}>Unrealized P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {activePositions.map((pos) => (
                <tr
                  key={pos.market_id + "-" + pos.side}
                  className="[&:last-child>td]:border-b-0"
                >
                  <td className={tdSong}>
                    <button
                      className={textBtn}
                      onClick={() => onOpenMarket(pos.market_id, pos.side)}
                    >
                      <strong>{pos.title}</strong>
                    </button>
                    <span className="text-[11px] text-muted">{pos.artist}</span>
                    <small className="text-[11px] text-muted">
                      {marketQuestion(pos)}
                    </small>
                  </td>
                  <td className={tdBase}>{pos.chart_date}</td>
                  <td className={tdBase}>
                    <span
                      className={`${sideBadge} ${
                        pos.side === "yes"
                          ? "bg-up-bg text-[#4f826a]"
                          : "bg-down-bg text-down"
                      }`}
                    >
                      {sideLabel(pos.baseline_rank, pos.side)}
                    </span>
                  </td>
                  <td className={tdNum}>
                    {pos.quantity.toLocaleString()}
                    {pos.reserved_sell > 0 && (
                      <small className="text-muted">
                        {" "}
                        ({pos.reserved_sell} listed)
                      </small>
                    )}
                  </td>
                  <td className={tdNum}>♫ {pos.cost_basis.toLocaleString()}</td>
                  <td className={tdNum}>♫ {pos.current_price}</td>
                  <td className={tdNum}>♫ {pos.market_value.toLocaleString()}</td>
                  <td
                    className={`${tdNum} ${
                      pos.unrealized_pnl >= 0 ? "text-up" : "text-[#b27068]"
                    }`}
                  >
                    {formatNotes(pos.unrealized_pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "active" && pendingOrders.length > 0 && (
        <div className={tableWrap}>
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={thBase}>Pending Order</th>
                <th className={thBase}>Chart Date</th>
                <th className={thBase}>Type</th>
                <th className={thBase}>Side</th>
                <th className={thNum}>Waiting / Total</th>
                <th className={thNum}>Limit Price</th>
                <th className={thNum}>Reserved</th>
                <th className={thNum}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingOrders.map((order) => (
                <tr
                  key={order.order_id}
                  className="[&:last-child>td]:border-b-0"
                >
                  <td className={tdSong}>
                    <button
                      className={textBtn}
                      onClick={() => onOpenMarket(order.market_id, order.side)}
                    >
                      <strong>{order.title}</strong>
                    </button>
                    <span className="text-[11px] text-muted">{order.artist}</span>
                    <small className="text-[11px] text-muted">
                      {marketQuestion(order)}
                    </small>
                  </td>
                  <td className={tdBase}>{order.chart_date}</td>
                  <td className={tdBase}>
                    <span className="inline-block rounded-[10px] bg-surface-soft px-2 py-[3px] text-[10px] font-semibold text-[#7e8175]">
                      {order.action === "buy" ? "Pending Buy" : "Pending Sell"}
                    </span>
                  </td>
                  <td className={tdBase}>
                    <span
                      className={`${sideBadge} ${
                        order.side === "yes"
                          ? "bg-up-bg text-[#4f826a]"
                          : "bg-down-bg text-down"
                      }`}
                    >
                      {sideLabel(order.baseline_rank, order.side)}
                    </span>
                  </td>
                  <td className={tdNum}>
                    {order.remaining.toLocaleString()} /{" "}
                    {order.quantity.toLocaleString()}
                  </td>
                  <td className={tdNum}>♫ {order.price}</td>
                  <td className={tdNum}>
                    {order.action === "buy"
                      ? "♫ " + (order.price * order.remaining).toLocaleString()
                      : order.remaining.toLocaleString() + " contracts"}
                  </td>
                  <td className={tdNum}>
                    <button
                      className={textBtn}
                      disabled={busyOrderId === order.order_id}
                      onClick={() => void cancelPendingOrder(order.order_id)}
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "resolved" && resolvedPositions.length === 0 && (
        <p className={emptyBox}>
          No resolved positions yet. Positions move here once their weekly chart
          settles.
        </p>
      )}

      {tab === "resolved" && resolvedPositions.length > 0 && (
        <div className={tableWrap}>
          <table className={tableClass}>
            <thead>
              <tr>
                <th className={thBase}>Song</th>
                <th className={thBase}>Chart Date</th>
                <th className={thBase}>Side</th>
                <th className={thNum}>Contracts Bought</th>
                <th className={thNum}>Cost Basis</th>
                <th className={thNum}>Payout / Sales</th>
                <th className={thNum}>Realized P&amp;L</th>
                <th className={thBase}>Result</th>
              </tr>
            </thead>
            <tbody>
              {resolvedPositions.map((pos) => (
                <tr
                  key={pos.market_id + "-" + pos.side}
                  className="[&:last-child>td]:border-b-0"
                >
                  <td className={tdSong}>
                    <strong>{pos.title}</strong>
                    <span className="text-[11px] text-muted">{pos.artist}</span>
                    <small className="text-[11px] text-muted">
                      {marketQuestion(pos)}
                    </small>
                  </td>
                  <td className={tdBase}>{pos.chart_date}</td>
                  <td className={tdBase}>
                    <span
                      className={`${sideBadge} ${
                        pos.side === "yes"
                          ? "bg-up-bg text-[#4f826a]"
                          : "bg-down-bg text-down"
                      }`}
                    >
                      {sideLabel(pos.baseline_rank, pos.side)}
                    </span>
                  </td>
                  <td className={tdNum}>{pos.contracts.toLocaleString()}</td>
                  <td className={tdNum}>♫ {pos.cost_basis.toLocaleString()}</td>
                  <td className={tdNum}>♫ {pos.proceeds.toLocaleString()}</td>
                  <td
                    className={`${tdNum} ${
                      pos.realized_pnl >= 0 ? "text-up" : "text-[#b27068]"
                    }`}
                  >
                    {formatNotes(pos.realized_pnl)}
                  </td>
                  <td className={tdBase}>
                    <span
                      className={`inline-block rounded-[10px] px-2 py-[3px] text-[10px] font-semibold ${
                        resultBadgeStyles[pos.result.toLowerCase()] ??
                        "bg-surface-soft text-[#7e8175]"
                      }`}
                    >
                      {pos.result}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
