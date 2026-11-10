package main

import (
	"context"
	"database/sql"
	"errors"
)

var (
	ErrInvalidPeriod  = errors.New("period must be week, month or all")
	ErrNoSuchGroup    = errors.New("group does not exist")
	ErrAlreadyMember  = errors.New("already a member of this group")
	ErrGroupNameTaken = errors.New("a group with that name already exists")
)

// Days back from today each leaderboard period covers; 0 means all time.
var leaderboardDays = map[string]int{"week": 7, "month": 30, "all": 0}

type Group struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Members int    `json:"members"`
}

type LeaderboardRow struct {
	Rank   int    `json:"rank"`
	UserID int64  `json:"user_id"`
	Name   string `json:"name"`
	PnL    int64  `json:"pnl"`
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

func CreateGroup(ctx context.Context, db *sql.DB, name string) (int64, error) {
	var id int64
	err := db.QueryRowContext(ctx,
		`INSERT INTO user_groups (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id`, name).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrGroupNameTaken
	}
	return id, err
}

// MyGroups lists the groups the user belongs to, with each group's member count.
func MyGroups(ctx context.Context, db *sql.DB, userID int64) ([]Group, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT g.id, g.name, (SELECT count(*) FROM group_members c WHERE c.group_id = g.id)
		FROM user_groups g JOIN group_members m ON m.group_id = g.id
		WHERE m.user_id = $1
		ORDER BY g.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []Group{}
	for rows.Next() {
		var g Group
		if err := rows.Scan(&g.ID, &g.Name, &g.Members); err != nil {
			return nil, err
		}
		groups = append(groups, g)
	}
	return groups, rows.Err()
}

func JoinGroup(ctx context.Context, db *sql.DB, userID, groupID int64) error {
	var exists bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM user_groups WHERE id = $1)`, groupID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNoSuchGroup
	}
	res, err := db.ExecContext(ctx,
		`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, groupID, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrAlreadyMember
	}
	return nil
}
