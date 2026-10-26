from ingestion.validation import validate_song, validate_snapshot
from ingestion.objects.Song import Song
from ingestion.objects.Snapshot import Snapshot


# Song tests
def test_song_is_valid():
    song = Song("song", "artist", 1)
    assert validate_song(song) is True


def test_spaces_in_title_are_valid():
    song = Song("song title", "artist", 1)
    assert validate_song(song) is True


def test_spaces_in_artist_is_valid():
    song = Song("song title", "artist name", 1)
    assert validate_song(song) is True


def test_song_with_empty_title_is_invalid():
    song = Song("", "Example Artist", 1)
    assert validate_song(song) is False


def test_whitespace_only_title_is_invalid():
    song = Song("   ", "Artist", 1)
    assert validate_song(song) is False


def test_empty_artist_is_invalid():
    song = Song("Song", "", 1)
    assert validate_song(song) is False


def test_whitespace_only_artist_is_invalid():
    song = Song("Song", "   ", 1)
    assert validate_song(song) is False


def test_none_title_is_invalid():
    song = Song(None, "Artist", 1)
    assert validate_song(song) is False


def test_none_artist_is_invalid():
    song = Song("Song", None, 1)
    assert validate_song(song) is False


def test_none_rank_is_invalid():
    song = Song("Song", "Artist", None)
    assert validate_song(song) is False


def test_numeric_title_is_invalid():
    song = Song(123, "Artist", 1)
    assert validate_song(song) is False


def test_zero_rank_is_invalid():
    song = Song("Song", "Artist", 0)
    assert validate_song(song) is False


def test_negative_rank_is_invalid():
    song = Song("Song", "Artist", -1)
    assert validate_song(song) is False


def test_string_rank_is_invalid():
    song = Song("Song", "Artist", "1")
    assert validate_song(song) is False


def test_decimal_rank_is_invalid():
    song = Song("Song", "Artist", 1.5)
    assert validate_song(song) is False


def test_boolean_rank_is_invalid():
    song = Song("Song", "Artist", True)
    assert validate_song(song) is False


def test_none_input_is_invalid():
    assert validate_song(None) is False


def test_list_input_is_invalid():
    assert validate_song([]) is False


def test_unicode_title_and_artist_are_valid():
    song = Song("Déjà Vu", "Beyoncé", 2)
    assert validate_song(song) is True


# Snapshot tests
def make_snapshot():
    songs = []

    for rank in range(1, 101):
        song = Song("Song " + str(rank), "Artist", rank)
        songs.append(song)

    return Snapshot("hot-100", "2026-10-17", songs)


def test_valid_snapshot():
    snapshot = make_snapshot()
    validate_snapshot(snapshot)


def test_snapshot_with_invalid_date():
    snapshot = make_snapshot()
    snapshot.chart_date = "2026-02-30"

    error_found = False

    try:
        validate_snapshot(snapshot)
    except ValueError:
        error_found = True

    assert error_found is True


def test_snapshot_with_duplicate_ranks():
    snapshot = make_snapshot()
    snapshot.songs[1].rank = 1

    error_found = False

    try:
        validate_snapshot(snapshot)
    except ValueError:
        error_found = True

    assert error_found is True


def test_snapshot_with_too_few_songs():
    snapshot = make_snapshot()
    snapshot.songs.pop()

    error_found = False

    try:
        validate_snapshot(snapshot)
    except ValueError:
        error_found = True

    assert error_found is True


def test_snapshot_with_invalid_song():
    snapshot = make_snapshot()
    snapshot.songs[0].title = ""

    error_found = False

    try:
        validate_snapshot(snapshot)
    except ValueError:
        error_found = True

    assert error_found is True


def test_snapshot_with_duplicate_songs():
    snapshot = make_snapshot()
    snapshot.songs[1].title = "Song 1"

    error_found = False

    try:
        validate_snapshot(snapshot)
    except ValueError:
        error_found = True

    assert error_found is True


def test_snapshot_with_none_date():
    snapshot = make_snapshot()
    snapshot.chart_date = None

    error_found = False

    try:
        validate_snapshot(snapshot)
    except ValueError:
        error_found = True

    assert error_found is True


def test_snapshot_with_wrong_date_format():
    snapshot = make_snapshot()
    snapshot.chart_date = "10/17/2026"

    error_found = False

    try:
        validate_snapshot(snapshot)
    except ValueError:
        error_found = True

    assert error_found is True