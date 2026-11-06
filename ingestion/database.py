import os
from datetime import date
import psycopg
from ingestion import validation


def save_snapshot(snapshot):
    #Check the data before saving
    validation.validate_snapshot(snapshot)

    chart_date = date.fromisoformat(snapshot.chart_date)
    songs = snapshot.songs

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not set.")

    with psycopg.connect(database_url, connect_timeout=10) as connection:
        with connection.cursor() as cursor:
            for song in songs:
                title = song.title
                artist = song.artist
                rank = song.rank

                #Add the song, or get its ID if it already exists
                query = "INSERT INTO songs (title, artist) VALUES (%s, %s) ON CONFLICT (title, artist) DO UPDATE SET title = EXCLUDED.title RETURNING id"
                cursor.execute(query, (title, artist))

                result = cursor.fetchone()
                song_id = result[0]

                query = "INSERT INTO chart_snapshots (chart, song_id, chart_date, rank) VALUES (%s, %s, %s, %s) ON CONFLICT (chart, song_id, chart_date) DO NOTHING"
                cursor.execute(query, (snapshot.chart_name, song_id, chart_date, rank))

                #Get the saved rank for this song, chart and date
                query = "SELECT rank FROM chart_snapshots WHERE chart = %s AND song_id = %s AND chart_date = %s"
                cursor.execute(query, (snapshot.chart_name, song_id, chart_date))


                result = cursor.fetchone()
                saved_rank = result[0]

                if saved_rank != rank:
                    raise ValueError("The saved rank does not match the downloaded rank.")

    return chart_date