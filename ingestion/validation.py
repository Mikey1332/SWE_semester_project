def validate_song(song):
    if not isinstance(song, dict):
        return False

    title = song.get("title")
    artist = song.get("artist")
    rank = song.get("rank")

    return (
        isinstance(title, str)
        and bool(title.strip())
        and isinstance(artist, str)
        and bool(artist.strip())
        and type(rank) is int
        and 1 <= rank <= 100
    )