package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"runtime/debug"
	"time"
)

// closeDaysBefore is how many days before a chart's date trading stops.
// Billboard publishes the chart dated Saturday D on Tuesday D-4, so markets
// close at midnight New York time on Monday D-5, before the answer is public.
const closeDaysBefore = 5

const botInterval = 15 * time.Minute
const (
	botMinPrice = 40
	botMaxPrice = 60
	botMaxFill  = 5
)

func countertrade(ctx context.Context, db *sql.DB, botUserID int64) error {
	var waiting Order
	err := db.QueryRowContext(ctx, `
        SELECT o.market_id, o.side, o.action, o.price, o.remaining
        FROM orders o
        JOIN markets m ON m.id = o.market_id
        WHERE o.user_id <> $1
          AND o.remaining > 0
          AND NOT o.cancelled
          AND o.price BETWEEN $2 AND $3
          AND m.status = 'open'
          AND m.closes_at > clock_timestamp()
        ORDER BY o.id
        LIMIT 1
    `, botUserID, botMinPrice, botMaxPrice).Scan(
		&waiting.MarketID, &waiting.Side, &waiting.Action,
		&waiting.Price, &waiting.Remaining,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil // No possible trades
	}
	if err != nil {
		return err
	}

	side := waiting.Side
	price := waiting.Price
	if waiting.Action == "buy" {
		// Matches where sum = 1
		if side == "yes" {
			side = "no"
		} else {
			side = "yes"
		}
		price = ContractPayout - price
	}

	_, err = PlaceOrder(ctx, db, Order{
		UserID:       botUserID,
		MarketID:     waiting.MarketID,
		RequestID:    "countertrade-" + rand.Text(),
		Side:         side,
		Action:       "buy",
		Price:        price,
		Quantity:     min(waiting.Remaining, botMaxFill),
		countertrade: true,
	})
	return err
}
func suggest(ranks []int) (shift, yesPrice int) {
	current := ranks[len(ranks)-1]
	wins := 0
	decisions := 0
	for i := 1; i < len(ranks); i++ {
		previous := ranks[i-1]
		next := ranks[i]
		if current == 1 {
			if previous != 1 {
				continue
			}
			decisions++
			if next == 1 {
				wins++
			}
		} else if next != previous {
			decisions++
			if next < previous {
				wins++
			}
		}
	}
	price := 100 * (wins + 1) / (decisions + 2)
	if price < 1 {
		price = 1
	}
	if price > 99 {
		price = 99
	}
	return 1, price
}

// CreateMarkets has the bot open one market per song on the chart dated
// chartDate, asking about that song's rank on the next week's chart. Songs that
// already have a market for that week are skipped. It returns how many it opened.
func CreateMarkets(ctx context.Context, db *sql.DB, chartDate string) (int, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT song_id, rank FROM chart_snapshots
		WHERE chart = 'hot-100' AND chart_date <= $1
		  AND song_id IN (SELECT song_id FROM chart_snapshots WHERE chart = 'hot-100' AND chart_date = $1)
		ORDER BY song_id, chart_date`, chartDate)
	if err != nil {
		return 0, err
	}
	history := map[int64][]int{}
	for rows.Next() {
		var songID int64
		var rank int
		if err := rows.Scan(&songID, &rank); err != nil {
			rows.Close()
			return 0, err
		}
		history[songID] = append(history[songID], rank)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	opened := 0
	for songID, ranks := range history {
		shift, price := suggest(ranks)
		res, err := tx.ExecContext(ctx, `
			INSERT INTO markets (song_id, chart_date, baseline_rank, shift, yes_price, closes_at)
			SELECT $1::bigint, d, $3, $4, $5, (d - $6::int)::timestamp AT TIME ZONE 'America/New_York'
			FROM (SELECT $2::date + 7 AS d) next
			WHERE NOT EXISTS (SELECT 1 FROM markets WHERE song_id = $1::bigint AND chart_date = d)`,
			songID, chartDate, ranks[len(ranks)-1], shift, price, closeDaysBefore)
		if err != nil {
			return 0, err
		}
		n, _ := res.RowsAffected()
		opened += int(n)
	}
	return opened, tx.Commit()
}

// RunBots calls botTick every botInterval until ctx is cancelled.
func RunBots(ctx context.Context, db *sql.DB, botUserID int64) {
	for {
		runBotTick(ctx, db, botUserID)
		select {
		case <-ctx.Done():
			return
		case <-time.After(botInterval):
		}
	}
}

func runBotTick(ctx context.Context, db *sql.DB, botUserID int64) {
	defer func() {
		if p := recover(); p != nil {
			log.Printf("bots: panic: %v\n%s", p, debug.Stack())
		}
	}()
	if err := botTick(ctx, db); err != nil {
		log.Printf("bots: %v", err)
	}
	if botUserID > 0 {
		if err := countertrade(ctx, db, botUserID); err != nil {
			log.Printf("bots: countertrade error: %v", err)
		}
	}
}

// botTick resolves every open market whose chart has been ingested, then opens
// markets from the latest chart. Ingestion only has to load chart_snapshots.
func botTick(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx, `
		SELECT id FROM markets m
		WHERE status = 'open'
		  AND (SELECT count(*) FROM chart_snapshots c WHERE c.chart = 'hot-100' AND c.chart_date = m.chart_date) >= $1`, ChartSize)
	if err != nil {
		return err
	}
	var due []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		due = append(due, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	var errs []error
	for _, id := range due { // one bad market must not stop the rest from paying out
		if err := Resolve(ctx, db, id); err != nil {
			errs = append(errs, fmt.Errorf("settlement failed: resolve market %d: %w", id, err))
		}
	}
	if len(due) > 0 {
		log.Printf("bots: resolved %d markets", len(due)-len(errs))
	}

	var latest sql.NullString
	if err := db.QueryRowContext(ctx, `
		SELECT max(chart_date)::text FROM (
			SELECT chart_date FROM chart_snapshots WHERE chart = 'hot-100' GROUP BY chart_date HAVING count(*) >= $1
		) complete`, ChartSize).Scan(&latest); err != nil {
		return errors.Join(append(errs, err)...)
	}
	if latest.Valid {
		opened, err := CreateMarkets(ctx, db, latest.String)
		if opened > 0 {
			log.Printf("bots: opened %d markets from the %s chart", opened, latest.String)
		}
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}
