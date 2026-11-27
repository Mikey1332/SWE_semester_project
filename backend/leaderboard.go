package main

import (
	"context"
	"database/sql"
	"errors"
)

var (
	ErrInvalidPeriod = errors.New("period must be week, month or all")
)

// Days back from today each leaderboard period covers; 0 means all time.
var leaderboardDays = map[string]int{"week": 7, "month": 30, "all": 0}

type LeaderboardRow struct {
	Rank   int    `json:"rank"`
	UserID int64  `json:"user_id"`
	Name   string `json:"name"`
	PnL    int64  `json:"pnl"`
}

// ProfileLeaderboard uses the same realized + unrealized P&L as GetProfile.
// Query every profile on each request so new users need no enrollment or backfill.
// A stable ID tie-breaker keeps equal P&L rankings consistent.
func ProfileLeaderboard(ctx context.Context, db *sql.DB) ([]LeaderboardRow, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT u.id,
		       COALESCE(NULLIF(BTRIM(u.username), ''), NULLIF(split_part(u.email, '@', 1), ''), 'Player'),
		       pnl.realized_pnl + COALESCE(pos.unrealized_pnl, 0) AS total_pnl
		FROM users u
		JOIN user_pnl pnl ON pnl.user_id = u.id
		LEFT JOIN (
			SELECT p.user_id, SUM(p.quantity::bigint * CASE WHEN p.side = 'yes'
			       THEN m.yes_price ELSE 100 - m.yes_price END - p.cost_basis) AS unrealized_pnl
			FROM positions p JOIN markets m ON m.id = p.market_id
			GROUP BY p.user_id
		) pos ON pos.user_id = u.id
		ORDER BY total_pnl DESC, u.id ASC
		LIMIT 10
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	board := []LeaderboardRow{}
	for rows.Next() {
		row := LeaderboardRow{Rank: len(board) + 1}
		if err := rows.Scan(&row.UserID, &row.Name, &row.PnL); err != nil {
			return nil, err
		}
		board = append(board, row)
	}
	return board, rows.Err()
}

// Leaderboard ranks users by realized P&L (buys, sells and payouts) in markets
// that settled on charts dated within the period. With groupID it ranks only
// that group's members.
func Leaderboard(ctx context.Context, db *sql.DB, period string, groupID *int64) ([]LeaderboardRow, error) {
	days, ok := leaderboardDays[period]
	if !ok {
		return nil, ErrInvalidPeriod
	}
	rows, err := db.QueryContext(ctx, `
		SELECT u.id, coalesce(u.username, split_part(u.email, '@', 1), 'Player ' || u.id), coalesce(sum(l.amount), 0)
		FROM users u
		LEFT JOIN (ledger_entries l JOIN markets m ON m.id = l.market_id AND m.status = 'resolved' AND ($1 = 0 OR m.chart_date >= current_date - $1::int))
			ON l.user_id = u.id AND l.kind IN ('buy', 'sell', 'payout')
		WHERE CASE WHEN $2::bigint IS NULL THEN l.id IS NOT NULL
			ELSE EXISTS (SELECT 1 FROM group_members g WHERE g.group_id = $2 AND g.user_id = u.id) END
		GROUP BY u.id
		ORDER BY 3 DESC, u.id`, days, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	board := []LeaderboardRow{}
	for rows.Next() {
		r := LeaderboardRow{Rank: len(board) + 1}
		if err := rows.Scan(&r.UserID, &r.Name, &r.PnL); err != nil {
			return nil, err
		}
		board = append(board, r)
	}
	return board, rows.Err()
}
