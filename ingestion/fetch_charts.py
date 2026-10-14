from ingestion import billboard_fixed as billboard
from ingestion.validation import validate_song

def fetch_hot_100():
    chart = billboard.ChartData("hot-100", timeout=30)

    songs = []
    for entry in chart:
        song = {
            "title": entry.title,
            "artist": entry.artist,
            "rank": entry.rank,
        }

        if not validate_song(song):
            raise ValueError(f"Invalid chart entry: {song}")

        songs.append(song)

    return {"chart_date": chart.date, "songs": songs}


if __name__ == "__main__":
    snapshot = fetch_hot_100()
    print("Chart date:", snapshot["chart_date"])
    print("Songs fetched:", len(snapshot["songs"]))
    print(snapshot["songs"][:3])