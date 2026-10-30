package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"
)

// closeDaysBefore is how many days before a chart's date trading stops.
// Billboard publishes the chart dated Saturday D on Tuesday D-4, so markets
// close at midnight New York time on Monday D-5, before the answer is public.
// ponytail: calibration knob; move it if Billboard's release day shifts.
const closeDaysBefore = 5

const botInterval = 15 * time.Minute

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
		WHERE chart_date <= $1
		  AND song_id IN (SELECT song_id FROM chart_snapshots WHERE chart_date = $1)
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
func RunBots(ctx context.Context, db *sql.DB) {
	for {
		if err := botTick(ctx, db); err != nil {
			log.Printf("bots: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(botInterval):
		}
	}
}

// botTick resolves every open market whose chart has been ingested, then opens
// markets from the latest chart. Ingestion only has to load chart_snapshots.
func botTick(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx, `
		SELECT id FROM markets m
		WHERE status = 'open'
		  AND (SELECT count(*) FROM chart_snapshots c WHERE c.chart_date = m.chart_date) >= $1`, ChartSize)
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
			errs = append(errs, fmt.Errorf("resolve market %d: %w", id, err))
		}
	}
	if len(due) > 0 {
		log.Printf("bots: resolved %d markets", len(due)-len(errs))
	}

	var latest sql.NullString
	if err := db.QueryRowContext(ctx, `
		SELECT max(chart_date)::text FROM (
			SELECT chart_date FROM chart_snapshots GROUP BY chart_date HAVING count(*) >= $1
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
