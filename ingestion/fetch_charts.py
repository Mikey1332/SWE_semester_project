from ingestion import billboard_fixed as billboard
from ingestion.validation import validate_song

def fetch_chart(chart_type):
    chart = billboard.ChartData(chart_type, timeout=30)

    songs = []
    for entry in chart:
        song = {"title": entry.title, "artist": entry.artist, "rank": entry.rank }

        if not validate_song(song):
            raise ValueError(f"Invalid chart entry: {song}")

        songs.append(song)

    return {"chart_date": chart.date, "songs": songs}