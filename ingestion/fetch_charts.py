from ingestion import billboard_fixed as billboard
from ingestion.validation import validate_song
from ingestion.objects.Song import Song
from ingestion.objects.Snapshot import Snapshot

def fetch_chart(chart_type):
    chart = billboard.ChartData(chart_type, timeout=30)

    songs = []
    for entry in chart:
        song = Song(entry.title, entry.artist, entry.rank)

        if not validate_song(song):
            raise ValueError(f"Invalid chart entry: {song}")

        songs.append(song)

    return Snapshot(chart_type, chart.date, songs)