from datetime import date
from ingestion.objects.Song import Song
from ingestion.objects.Snapshot import Snapshot

CHART_SIZES = {
    "hot-100": 100,
    "country-songs": 50,
    "rock-songs": 50,
    "pop-songs": 40,
    "r-b-hip-hop-songs": 50,
}

def validate_song(song):
    if not isinstance(song, Song):
        return False

    title = song.title
    artist = song.artist
    rank = song.rank

    return (
        isinstance(title, str)
        and bool(title.strip())
        and isinstance(artist, str)
        and bool(artist.strip())
        and type(rank) is int
        and 1 <= rank <= 100
    )


def validate_snapshot(snapshot):
    # Check snapshot is a Snapshot object
    if not isinstance(snapshot, Snapshot):
        raise ValueError("Snapshot must be a Snapshot object.")

    # Check chart is supported
    if snapshot.chart_name not in CHART_SIZES:
        raise ValueError("Chart is not supported.")

    expected_size = CHART_SIZES[snapshot.chart_name]

    # Check date is a string
    chart_date = snapshot.chart_date
    if not isinstance(chart_date, str):
        raise ValueError("Chart date must be a YYYY-MM-DD string.")

    # Check date is valid
    try:
        parsed_date = date.fromisoformat(chart_date)
    except ValueError as error:
        raise ValueError("Invalid chart date.") from error

    # Check date uses the correct format
    if parsed_date.isoformat() != chart_date:
        raise ValueError("Chart date must use YYYY-MM-DD format.")

    # Check songs are a list of the expected size
    songs = snapshot.songs
    if not isinstance(songs, list) or len(songs) != expected_size:
        raise ValueError("Expected " + str(expected_size) + " songs. Got " + str(len(songs)) + " songs.")

    # Check each song is valid
    for song in songs:
        if not validate_song(song):
            raise ValueError("Snapshot contains invalid song data.")

        if song.rank > expected_size:
            raise ValueError("Rank exceeds the chart size.")

    # Check ranks are unique
    ranks = set()

    for song in songs:
        ranks.add(song.rank)

    if len(songs) != len(ranks):
        raise ValueError("Expected ranks to be unique.")

    # Check each song is unique
    identities = set()

    for song in songs:
        title = song.title.strip().lower()
        artist = song.artist.strip().lower()
        identities.add((title, artist))

    if len(songs) != len(identities):
        raise ValueError("Duplicate songs found.")