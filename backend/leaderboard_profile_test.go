package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
)

func TestProfileLeaderboardMatchesProfilesAndLimitsToTen(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	settled := resolvedMarket(t, db, 1)
	active, _, _ := newMarket(t, db, 30, 1, 50)
	for i := 0; i < 12; i++ {
		user := newUser(t, db)
		// Include new non-traders, ties, gains, losses, and both active sides.
		if i > 1 {
			earn(t, db, user, settled, int64((i-4)*100+50))
		}
		if i == 10 || i == 11 {
			side := "yes"
			if i == 11 {
				side = "no"
			}
			if _, err := buyForTest(t, ctx, db, user, active, side, 2); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := db.ExecContext(ctx, "UPDATE markets SET yes_price = 70 WHERE id = $1", active); err != nil {
		t.Fatal(err)
	}

	// Build the expected ranking from actual profile results independently of
	// the aggregate leaderboard query, including any pre-existing test users.
	rows, err := db.QueryContext(ctx, "SELECT id FROM users")
	if err != nil {
		t.Fatal(err)
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		t.Fatal(err)
	}
	var expected []Profile
	for _, id := range ids {
		p, err := GetProfile(ctx, db, id)
		if err != nil {
			t.Fatal(err)
		}
		expected = append(expected, p)
	}
	sort.Slice(expected, func(i, j int) bool {
		if expected[i].TotalPnL == expected[j].TotalPnL {
			return expected[i].UserID < expected[j].UserID
		}
		return expected[i].TotalPnL > expected[j].TotalPnL
	})
	board, err := ProfileLeaderboard(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if len(board) != 10 {
		t.Fatalf("got %d entries, want 10", len(board))
	}
	for i, row := range board {
		if row.Rank != i+1 || row.UserID != expected[i].UserID || row.PnL != expected[i].TotalPnL || row.Name != expected[i].Username {
			t.Errorf("rank %d: got %+v, want user %d (%s) with P&L %d", i+1, row, expected[i].UserID, expected[i].Username, expected[i].TotalPnL)
		}
	}
}

func TestProfileLeaderboardUnavailableWithoutDatabase(t *testing.T) {
	response := httptest.NewRecorder()
	routes(nil).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/leaderboard/profiles", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("got status %d, want 503", response.Code)
	}
}
