-- Genre charts (pop-songs, country-songs, rock-songs, r-b-hip-hop-songs) share
-- this table with the Hot 100, so every row says which chart it belongs to.
ALTER TABLE chart_snapshots ADD COLUMN chart text NOT NULL DEFAULT 'hot-100';
ALTER TABLE chart_snapshots DROP CONSTRAINT chart_snapshots_song_id_chart_date_key;
ALTER TABLE chart_snapshots DROP CONSTRAINT chart_snapshots_chart_date_rank_key;
ALTER TABLE chart_snapshots ADD CONSTRAINT chart_snapshots_chart_song_date_key UNIQUE (chart, song_id, chart_date);
ALTER TABLE chart_snapshots ADD CONSTRAINT chart_snapshots_chart_date_rank_key UNIQUE (chart, chart_date, rank);
