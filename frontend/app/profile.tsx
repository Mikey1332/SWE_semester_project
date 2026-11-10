"use client";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
    formatNotes,
    marketQuestion,
    sideLabel,
    winRatePercent,
    type LiveMarket,
    type ProfileData,
    type TradeAction,
    type TradeSide,
} from "./trading";

type RawOrder = {
    id: number;
    market_id: number;
    side: TradeSide;
    action: TradeAction;
    price: number;
    quantity: number;
    remaining: number;
    cancelled: boolean;
};

export function ProfileView({
    user,
    markets,
    onSignUp,
    onOpenMarket,
}: {
    user: User | null;
    markets: LiveMarket[] | null;
    onSignUp: () => void;
    onOpenMarket: (marketId: number, side: TradeSide) => void;
}) {
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [rawOrders, setRawOrders] = useState<RawOrder[]>([]);
    const [error, setError] = useState("");
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
        const ordersResponse = await fetch("/api/me/orders", {
            headers: { Authorization: "Bearer " + token },
            cache: "no-store",
        });
        let ordersList: RawOrder[] = [];
        if (ordersResponse.ok) {
            ordersList = (await ordersResponse.json()) as RawOrder[];
        }
        const profileData = (await response.json()) as ProfileData;
        return { profileData, ordersList };
    }

    useEffect(() => {
        if (!user) {
            return;
        }
        const currentUser = user;
        let current = true;

        async function loadProfile() {
            setLoading(true);
            setError("");
            try {
                const result = await fetchProfileData(currentUser);
                if (current) {
                    setProfile(result.profileData);
                    setRawOrders(result.ordersList);
                    setLoading(false);
                }
            } catch (err) {
                if (current) {
                    setError(err instanceof Error ? err.message : "Could not load your profile.");
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
        setError("");
        try {
            const token = await user.getIdToken();
            const response = await fetch("/api/orders/" + orderId + "/cancel", {
                method: "POST",
                headers: { Authorization: "Bearer " + token },
            });
            if (!response.ok) {
                const text = await response.text();
                setError(text.trim() || "Could not cancel order.");
                setBusyOrderId(null);
                return;
            }
            const result = await fetchProfileData(user);
            setProfile(result.profileData);
            setRawOrders(result.ordersList);
            setBusyOrderId(null);
        } catch {
            setError("Could not cancel order.");
            setBusyOrderId(null);
        }
    }

    if (!user) {
        return (
            <section className="market-section ledger-section">
                <div className="live-empty">
                    Sign up or log in to view your profile, positions, P&amp;L, and win-loss record.{" "}
                    <button className="text-button" onClick={onSignUp}>
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
            <section className="market-section ledger-section">
                <p className="live-empty">Loading your profile…</p>
            </section>
        );
    }

    if (error !== "") {
        return (
            <section className="market-section ledger-section">
                <p className="live-empty">{error}</p>
            </section>
        );
    }

    if (!profile) {
        return null;
    }

    const activePositions = profile.active_positions || [];
    let pendingOrders = profile.pending_orders || [];
    if (pendingOrders.length === 0 && rawOrders.length > 0) {
        const mappedOrders = [];
        for (let i = 0; i < rawOrders.length; i++) {
            const ro = rawOrders[i];
            if (ro.remaining <= 0 || ro.cancelled) {
                continue;
            }
            let title = "Market #" + ro.market_id;
            let artist = "";
            let chartDate = "";
            let baselineRank = 50;
            let shift = 1;
            if (markets) {
                for (let j = 0; j < markets.length; j++) {
                    if (markets[j].id === ro.market_id) {
                        title = markets[j].title;
                        artist = markets[j].artist;
                        chartDate = markets[j].chart_date;
                        baselineRank = markets[j].baseline_rank;
                        shift = markets[j].shift;
                        break;
                    }
                }
            }
            mappedOrders.push({
                order_id: ro.id,
                market_id: ro.market_id,
                title: title,
                artist: artist,
                chart_date: chartDate,
                baseline_rank: baselineRank,
                shift: shift,
                side: ro.side,
                action: ro.action,
                price: ro.price,
                quantity: ro.quantity,
                remaining: ro.remaining,
            });
        }
        pendingOrders = mappedOrders;
    }
    const resolvedPositions = profile.resolved_positions || [];
    const winRate = winRatePercent(profile.wins, profile.losses);

    return (
        <section className="market-section ledger-section">
            <div className="section-heading">
                <div>
                    <span className="eyebrow">PLAYER PROFILE</span>
                    <h2>
                        {displayUsername}
                        <span className="purple-dot">.</span>
                    </h2>
                </div>
                <span className="week-label">
                    Portfolio <b>♫ {profile.portfolio_value.toLocaleString()}</b> · Available{" "}
                    <b>♫ {profile.available_balance.toLocaleString()}</b>
                </span>
            </div>

            <div className="profile-stats">
                <article className="stat-card">
                    <span className="eyebrow">MUSIC NOTE BALANCE</span>
                    <strong>♫ {profile.balance.toLocaleString()}</strong>
                    <small>
                        ♫ {profile.available_balance.toLocaleString()} available
                        {profile.reserved_cash > 0
                            ? " · ♫ " + profile.reserved_cash.toLocaleString() + " reserved"
                            : ""}
                    </small>
                </article>

                <article className="stat-card">
                    <span className="eyebrow">REALIZED P&amp;L</span>
                    <strong className={profile.realized_pnl >= 0 ? "positive" : "negative"}>
                        {formatNotes(profile.realized_pnl)}
                    </strong>
                    <small>From settled markets &amp; sales</small>
                </article>

                <article className="stat-card">
                    <span className="eyebrow">UNREALIZED P&amp;L</span>
                    <strong className={profile.unrealized_pnl >= 0 ? "positive" : "negative"}>
                        {formatNotes(profile.unrealized_pnl)}
                    </strong>
                    <small>{activePositions.length} active positions</small>
                </article>

                <article className="stat-card">
                    <span className="eyebrow">WIN-LOSS RECORD</span>
                    <strong>
                        {profile.wins}W – {profile.losses}L
                        {profile.refunds > 0 ? " – " + profile.refunds + "R" : ""}
                    </strong>
                    <small>
                        {winRate !== null ? winRate + "% win rate" : "No settled positions yet"}
                    </small>
                </article>
            </div>

            <div className="filters ledger-filters" role="group" aria-label="Position tabs">
                <button
                    aria-pressed={tab === "active"}
                    className={tab === "active" ? "active" : ""}
                    onClick={() => setTab("active")}
                >
                    Active positions ({activePositions.length + pendingOrders.length})
                </button>
                <button
                    aria-pressed={tab === "resolved"}
                    className={tab === "resolved" ? "active" : ""}
                    onClick={() => setTab("resolved")}
                >
                    Past positions ({resolvedPositions.length})
                </button>
            </div>

            {tab === "active" &&
                activePositions.length === 0 &&
                pendingOrders.length === 0 && (
                    <p className="live-empty">
                        No active positions or pending orders yet. Buy contracts on the Discover tab.
                    </p>
                )}

            {tab === "active" && activePositions.length > 0 && (
                <div className="ledger-table-wrap">
                    <table className="ledger-table">
                        <thead>
                            <tr>
                                <th>Song</th>
                                <th>Chart Date</th>
                                <th>Side</th>
                                <th className="num">Contracts</th>
                                <th className="num">Cost Basis</th>
                                <th className="num">Current Price</th>
                                <th className="num">Market Value</th>
                                <th className="num">Unrealized P&amp;L</th>
                            </tr>
                        </thead>
                        <tbody>
                            {activePositions.map(pos => (
                                <tr key={pos.market_id + "-" + pos.side}>
                                    <td className="ledger-song">
                                        <button
                                            className="text-button"
                                            onClick={() => onOpenMarket(pos.market_id, pos.side)}
                                        >
                                            <strong>{pos.title}</strong>
                                        </button>
                                        <span>{pos.artist}</span>
                                        <small>{marketQuestion(pos)}</small>
                                    </td>
                                    <td>{pos.chart_date}</td>
                                    <td>
                                        <span
                                            className={
                                                pos.side === "yes"
                                                    ? "up ledger-side"
                                                    : "down ledger-side"
                                            }
                                        >
                                            {sideLabel(pos.baseline_rank, pos.side)}
                                        </span>
                                    </td>
                                    <td className="num">
                                        {pos.quantity.toLocaleString()}
                                        {pos.reserved_sell > 0 && (
                                            <small className="muted">
                                                {" "}
                                                ({pos.reserved_sell} listed)
                                            </small>
                                        )}
                                    </td>
                                    <td className="num">♫ {pos.cost_basis.toLocaleString()}</td>
                                    <td className="num">♫ {pos.current_price}</td>
                                    <td className="num">♫ {pos.market_value.toLocaleString()}</td>
                                    <td
                                        className={
                                            pos.unrealized_pnl >= 0
                                                ? "num positive"
                                                : "num negative"
                                        }
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
                <div className="ledger-table-wrap">
                    <table className="ledger-table">
                        <thead>
                            <tr>
                                <th>Pending Order</th>
                                <th>Chart Date</th>
                                <th>Type</th>
                                <th>Side</th>
                                <th className="num">Waiting / Total</th>
                                <th className="num">Limit Price</th>
                                <th className="num">Reserved</th>
                                <th className="num">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pendingOrders.map(order => (
                                <tr key={order.order_id}>
                                    <td className="ledger-song">
                                        <button
                                            className="text-button"
                                            onClick={() => onOpenMarket(order.market_id, order.side)}
                                        >
                                            <strong>{order.title}</strong>
                                        </button>
                                        <span>{order.artist}</span>
                                        <small>{marketQuestion(order)}</small>
                                    </td>
                                    <td>{order.chart_date}</td>
                                    <td>
                                        <span className="ledger-result">
                                            {order.action === "buy" ? "Pending Buy" : "Pending Sell"}
                                        </span>
                                    </td>
                                    <td>
                                        <span
                                            className={
                                                order.side === "yes"
                                                    ? "up ledger-side"
                                                    : "down ledger-side"
                                            }
                                        >
                                            {sideLabel(order.baseline_rank, order.side)}
                                        </span>
                                    </td>
                                    <td className="num">
                                        {order.remaining.toLocaleString()} / {order.quantity.toLocaleString()}
                                    </td>
                                    <td className="num">♫ {order.price}</td>
                                    <td className="num">
                                        {order.action === "buy"
                                            ? "♫ " + (order.price * order.remaining).toLocaleString()
                                            : order.remaining.toLocaleString() + " contracts"}
                                    </td>
                                    <td className="num">
                                        <button
                                            className="text-button"
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
                <p className="live-empty">
                    No resolved positions yet. Positions move here once their weekly chart settles.
                </p>
            )}

            {tab === "resolved" && resolvedPositions.length > 0 && (
                <div className="ledger-table-wrap">
                    <table className="ledger-table">
                        <thead>
                            <tr>
                                <th>Song</th>
                                <th>Chart Date</th>
                                <th>Side</th>
                                <th className="num">Contracts Bought</th>
                                <th className="num">Cost Basis</th>
                                <th className="num">Payout / Sales</th>
                                <th className="num">Realized P&amp;L</th>
                                <th>Result</th>
                            </tr>
                        </thead>
                        <tbody>
                            {resolvedPositions.map(pos => (
                                <tr key={pos.market_id + "-" + pos.side}>
                                    <td className="ledger-song">
                                        <strong>{pos.title}</strong>
                                        <span>{pos.artist}</span>
                                        <small>{marketQuestion(pos)}</small>
                                    </td>
                                    <td>{pos.chart_date}</td>
                                    <td>
                                        <span
                                            className={
                                                pos.side === "yes"
                                                    ? "up ledger-side"
                                                    : "down ledger-side"
                                            }
                                        >
                                            {sideLabel(pos.baseline_rank, pos.side)}
                                        </span>
                                    </td>
                                    <td className="num">{pos.contracts.toLocaleString()}</td>
                                    <td className="num">♫ {pos.cost_basis.toLocaleString()}</td>
                                    <td className="num">♫ {pos.proceeds.toLocaleString()}</td>
                                    <td
                                        className={
                                            pos.realized_pnl >= 0
                                                ? "num positive"
                                                : "num negative"
                                        }
                                    >
                                        {formatNotes(pos.realized_pnl)}
                                    </td>
                                    <td>
                                        <span
                                            className={
                                                "ledger-result " + pos.result.toLowerCase()
                                            }
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
