package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"strings"
)

type ActivePosition struct {
	MarketID      int64  `json:"market_id"`
	Title         string `json:"title"`
	Artist        string `json:"artist"`
	ChartDate     string `json:"chart_date"`
	BaselineRank  int    `json:"baseline_rank"`
	Shift         int    `json:"shift"`
	Side          string `json:"side"`
	Quantity      int64  `json:"quantity"`
	ReservedSell  int64  `json:"reserved_sell"`
	CostBasis     int64  `json:"cost_basis"`
	CurrentPrice  int64  `json:"current_price"`
	MarketValue   int64  `json:"market_value"`
	UnrealizedPnL int64  `json:"unrealized_pnl"`
}

type ResolvedPosition struct {
	MarketID     int64  `json:"market_id"`
	Title        string `json:"title"`
	Artist       string `json:"artist"`
	ChartDate    string `json:"chart_date"`
	BaselineRank int    `json:"baseline_rank"`
	Shift        int    `json:"shift"`
	Side         string `json:"side"`
	Contracts    int64  `json:"contracts"`
	CostBasis    int64  `json:"cost_basis"`
	Proceeds     int64  `json:"proceeds"`
	RealizedPnL  int64  `json:"realized_pnl"`
	Outcome      string `json:"outcome"`
	Result       string `json:"result"`
}

type PendingProfileOrder struct {
	OrderID      int64  `json:"order_id"`
	MarketID     int64  `json:"market_id"`
	Title        string `json:"title"`
	Artist       string `json:"artist"`
	ChartDate    string `json:"chart_date"`
	BaselineRank int    `json:"baseline_rank"`
	Shift        int    `json:"shift"`
	Side         string `json:"side"`
	Action       string `json:"action"`
	Price        int64  `json:"price"`
	Quantity     int64  `json:"quantity"`
	Remaining    int64  `json:"remaining"`
}

type Profile struct {
	UserID           int64                 `json:"user_id"`
	UID              string                `json:"uid"`
	Username         string                `json:"username"`
	Email            string                `json:"email"`
	Balance          int64                 `json:"balance"`
	ReservedCash     int64                 `json:"reserved_cash"`
	AvailableBalance int64                 `json:"available_balance"`
	PortfolioValue   int64                 `json:"portfolio_value"`
	RealizedPnL      int64                 `json:"realized_pnl"`
	UnrealizedPnL    int64                 `json:"unrealized_pnl"`
	TotalPnL         int64                 `json:"total_pnl"`
	Wins             int                   `json:"wins"`
	Losses           int                   `json:"losses"`
	Refunds          int                   `json:"refunds"`
	ActivePositions  []ActivePosition      `json:"active_positions"`
	PendingOrders    []PendingProfileOrder `json:"pending_orders"`
	Resolved         []ResolvedPosition    `json:"resolved_positions"`
}

func GetProfile(ctx context.Context, db *sql.DB, userID int64) (Profile, error) {
	var p Profile
	p.ActivePositions = []ActivePosition{}
	p.PendingOrders = []PendingProfileOrder{}
	p.Resolved = []ResolvedPosition{}

	var username sql.NullString
	var email sql.NullString
	err := db.QueryRowContext(ctx, `
		SELECT u.id, u.firebase_uid, u.username, u.email, b.balance, pnl.realized_pnl
		FROM users u
		JOIN balances b ON b.user_id = u.id
		JOIN user_pnl pnl ON pnl.user_id = u.id
		WHERE u.id = $1
	`, userID).Scan(&p.UserID, &p.UID, &username, &email, &p.Balance, &p.RealizedPnL)
	if err != nil {
		return Profile{}, err
	}
	if email.Valid {
		p.Email = email.String
	}
	if username.Valid && username.String != "" {
		p.Username = username.String
	} else if p.Email != "" {
		parts := strings.Split(p.Email, "@")
		p.Username = parts[0]
	} else {
		p.Username = "Player"
	}

	err = db.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(orders.price * orders.remaining), 0)
		FROM orders
		JOIN markets ON markets.id = orders.market_id
		WHERE orders.user_id = $1
		  AND orders.action = 'buy'
		  AND orders.remaining > 0
		  AND orders.cancelled = false
		  AND markets.status = 'open'
		  AND clock_timestamp() < markets.closes_at
	`, userID).Scan(&p.ReservedCash)
	if err != nil {
		return Profile{}, err
	}

	p.AvailableBalance = p.Balance - p.ReservedCash

	activeRows, err := db.QueryContext(ctx, `
		SELECT positions.market_id, songs.title, songs.artist, markets.chart_date::text,
		       markets.baseline_rank, markets.shift, positions.side,
		       positions.quantity, positions.cost_basis, markets.yes_price
		FROM positions
		JOIN markets ON markets.id = positions.market_id
		JOIN songs ON songs.id = markets.song_id
		WHERE positions.user_id = $1
		ORDER BY markets.chart_date, markets.baseline_rank, positions.side
	`, userID)
	if err != nil {
		return Profile{}, err
	}
	defer activeRows.Close()

	var totalPositionValue int64
	for activeRows.Next() {
		var ap ActivePosition
		var yesPrice int64
		err = activeRows.Scan(
			&ap.MarketID, &ap.Title, &ap.Artist, &ap.ChartDate,
			&ap.BaselineRank, &ap.Shift, &ap.Side,
			&ap.Quantity, &ap.CostBasis, &yesPrice,
		)
		if err != nil {
			return Profile{}, err
		}

		if ap.Side == "yes" {
			ap.CurrentPrice = yesPrice
		} else {
			ap.CurrentPrice = 100 - yesPrice
		}

		ap.MarketValue = ap.Quantity * ap.CurrentPrice
		ap.UnrealizedPnL = ap.MarketValue - ap.CostBasis
		totalPositionValue = totalPositionValue + ap.MarketValue
		p.UnrealizedPnL = p.UnrealizedPnL + ap.UnrealizedPnL
		p.ActivePositions = append(p.ActivePositions, ap)
	}
	if activeRows.Err() != nil {
		return Profile{}, activeRows.Err()
	}

	for i := 0; i < len(p.ActivePositions); i++ {
		var reserved int64
		err = db.QueryRowContext(ctx, `
			SELECT COALESCE(SUM(remaining), 0)
			FROM orders
			WHERE user_id = $1
			  AND market_id = $2
			  AND side = $3
			  AND action = 'sell'
			  AND remaining > 0
			  AND cancelled = false
		`, userID, p.ActivePositions[i].MarketID, p.ActivePositions[i].Side).Scan(&reserved)
		if err != nil {
			return Profile{}, err
		}
		p.ActivePositions[i].ReservedSell = reserved
	}

	p.PortfolioValue = p.Balance + totalPositionValue
	p.TotalPnL = p.RealizedPnL + p.UnrealizedPnL

	pendingRows, err := db.QueryContext(ctx, `
		SELECT orders.id, orders.market_id, songs.title, songs.artist, markets.chart_date::text,
		       markets.baseline_rank, markets.shift, orders.side, orders.action,
		       orders.price, orders.quantity, orders.remaining
		FROM orders
		JOIN markets ON markets.id = orders.market_id
		JOIN songs ON songs.id = markets.song_id
		WHERE orders.user_id = $1
		  AND orders.remaining > 0
		  AND orders.cancelled = false
		  AND markets.status = 'open'
		  AND clock_timestamp() < markets.closes_at
		ORDER BY orders.id DESC
	`, userID)
	if err != nil {
		return Profile{}, err
	}
	defer pendingRows.Close()

	for pendingRows.Next() {
		var po PendingProfileOrder
		err = pendingRows.Scan(
			&po.OrderID, &po.MarketID, &po.Title, &po.Artist, &po.ChartDate,
			&po.BaselineRank, &po.Shift, &po.Side, &po.Action,
			&po.Price, &po.Quantity, &po.Remaining,
		)
		if err != nil {
			return Profile{}, err
		}
		p.PendingOrders = append(p.PendingOrders, po)
	}
	if pendingRows.Err() != nil {
		return Profile{}, pendingRows.Err()
	}

	resolvedRows, err := db.QueryContext(ctx, `
		SELECT markets.id, songs.title, songs.artist, markets.chart_date::text,
		       markets.baseline_rank, markets.shift, ledger_entries.side,
		       ledger_entries.kind, ledger_entries.amount,
		       COALESCE(ledger_entries.quantity, 0), COALESCE(markets.outcome, '')
		FROM ledger_entries
		JOIN markets ON markets.id = ledger_entries.market_id
		JOIN songs ON songs.id = markets.song_id
		WHERE ledger_entries.user_id = $1
		  AND markets.status = 'resolved'
		  AND ledger_entries.side IS NOT NULL
		ORDER BY markets.chart_date DESC, markets.id DESC, ledger_entries.id ASC
	`, userID)
	if err != nil {
		return Profile{}, err
	}
	defer resolvedRows.Close()

	for resolvedRows.Next() {
		var marketID int64
		var title string
		var artist string
		var chartDate string
		var baselineRank int
		var shift int
		var side string
		var kind string
		var amount int64
		var quantity int64
		var outcome string

		err = resolvedRows.Scan(
			&marketID, &title, &artist, &chartDate,
			&baselineRank, &shift, &side,
			&kind, &amount, &quantity, &outcome,
		)
		if err != nil {
			return Profile{}, err
		}

		foundIndex := -1
		for i := 0; i < len(p.Resolved); i++ {
			if p.Resolved[i].MarketID == marketID && p.Resolved[i].Side == side {
				foundIndex = i
				break
			}
		}

		if foundIndex == -1 {
			newPos := ResolvedPosition{
				MarketID:     marketID,
				Title:        title,
				Artist:       artist,
				ChartDate:    chartDate,
				BaselineRank: baselineRank,
				Shift:        shift,
				Side:         side,
				Outcome:      outcome,
			}
			p.Resolved = append(p.Resolved, newPos)
			foundIndex = len(p.Resolved) - 1
		}

		if kind == "buy" {
			p.Resolved[foundIndex].Contracts = p.Resolved[foundIndex].Contracts + quantity
			p.Resolved[foundIndex].CostBasis = p.Resolved[foundIndex].CostBasis - amount
		}
		if kind == "sell" || kind == "payout" || kind == "refund" {
			p.Resolved[foundIndex].Proceeds = p.Resolved[foundIndex].Proceeds + amount
		}
		if kind == "buy" || kind == "sell" || kind == "payout" || kind == "refund" {
			p.Resolved[foundIndex].RealizedPnL = p.Resolved[foundIndex].RealizedPnL + amount
		}
	}
	if resolvedRows.Err() != nil {
		return Profile{}, resolvedRows.Err()
	}

	for i := 0; i < len(p.Resolved); i++ {
		pos := p.Resolved[i]
		if pos.Outcome == "refund" && pos.RealizedPnL == 0 {
			p.Resolved[i].Result = "Refunded"
			p.Refunds = p.Refunds + 1
		} else if pos.RealizedPnL > 0 {
			p.Resolved[i].Result = "Won"
			p.Wins = p.Wins + 1
		} else if pos.RealizedPnL == 0 && pos.Outcome == pos.Side {
			p.Resolved[i].Result = "Won"
			p.Wins = p.Wins + 1
		} else {
			p.Resolved[i].Result = "Lost"
			p.Losses = p.Losses + 1
		}
	}

	return p, nil
}

func serveProfile(w http.ResponseWriter, r *http.Request, db *sql.DB) {
	userID, ok := signedIn(w, r)
	if !ok {
		return
	}
	if db == nil {
		http.Error(w, errNoDatabase.Error(), http.StatusServiceUnavailable)
		return
	}
	profile, err := GetProfile(r.Context(), db, userID)
	if err != nil {
		log.Printf("me/profile %d: %v", userID, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, profile)
}
