from datetime import date

def validate_song(song):
    if not isinstance(song, dict):
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
    #Check Snapshot is dictionary
    if not isinstance(snapshot, dict):
        raise ValueError("Snapshot must be a dictionary.")

    #Check Snapshot is Hot-100
    if snapshot.get("chart_name", "hot-100") != "hot-100":
        raise ValueError("Only Hot 100 snapshots are supported.")

    #Check Date is string
    chart_date = snapshot.get("chart_date")
    if not isinstance(chart_date, str):
        raise ValueError("Chart date must be a YYYY-MM-DD string.")

    #Check Date is valid date
    try:
        parsed_date = date.fromisoformat(chart_date)
    except ValueError as error:
        raise ValueError("Invalid chart date.") from error

    #Check Date is valid format
    if parsed_date.isoformat() != chart_date:
        raise ValueError("Chart date must use YYYY-MM-DD format.")

    #Check songs are a list of size 100
    songs = snapshot.get("songs")
    if not isinstance(songs, list) or len(songs) != 100:
        raise ValueError("Expected 100 songs.")

    #Check if song is invalid
    for song in songs:
        if not validate_song(song):
            raise ValueError("Snapshot contains invalid song data.")

    #Check if songs' ranks are valid and unique
    rank = set()
    for song in songs:
        rank.add(song["rank"])
        if song["rank"] < 1 or song["rank"] > 100:
            raise ValueError("Expected ranks from 1 to 100.")

    if len(songs) != len(rank):
        raise ValueError("Expected ranks to be unique.")

    # Check if each song is unique
    identities = set()

    for song in songs:
        title = song["title"].strip().lower()
        artist = song["artist"].strip().lower()
        identities.add((title, artist))

    if len(songs) != len(identities):
        raise ValueError("Duplicate songs found.")