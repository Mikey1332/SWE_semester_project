from ingestion.validation import validate_song, validate_snapshot

#Song Tests
def test_song_is_valid():
    # Set up the input
    song = {"title": "song", "artist": "artist", "rank": 1 }

    # Check the expected result
    assert validate_song(song) is True

def test_spaces_in_title_are_valid():
    # Set up the input
    song = {"title": "song title", "artist": "artist", "rank": 1 }

    # Check the expected result
    assert validate_song(song) is True

def test_spaces_in_artist_is_valid():
    # Set up the input
    song = {"title": "song title", "artist": "artist name", "rank": 1 }

    # Check the expected result
    assert validate_song(song) is True

def test_song_with_empty_title_is_invalid():
    # Set up the input
    song = {"title": "", "artist": "Example Artist", "rank": 1 }

    # Check the expected result
    assert validate_song(song) is False

def test_whitespace_only_title_is_invalid():
    song = {"title": "   ", "artist": "Artist", "rank": 1}
    assert validate_song(song) is False


def test_empty_artist_is_invalid():
    song = {"title": "Song", "artist": "", "rank": 1}
    assert validate_song(song) is False


def test_whitespace_only_artist_is_invalid():
    song = {"title": "Song", "artist": "   ", "rank": 1}
    assert validate_song(song) is False


def test_missing_title_is_invalid():
    song = {"artist": "Artist", "rank": 1}
    assert validate_song(song) is False


def test_missing_artist_is_invalid():
    song = {"title": "Song", "rank": 1}
    assert validate_song(song) is False


def test_missing_rank_is_invalid():
    song = {"title": "Song", "artist": "Artist"}
    assert validate_song(song) is False


def test_numeric_title_is_invalid():
    song = {"title": 123, "artist": "Artist", "rank": 1}
    assert validate_song(song) is False


def test_none_artist_is_invalid():
    song = {"title": "Song", "artist": None, "rank": 1}
    assert validate_song(song) is False


def test_zero_rank_is_invalid():
    song = {"title": "Song", "artist": "Artist", "rank": 0}
    assert validate_song(song) is False


def test_negative_rank_is_invalid():
    song = {"title": "Song", "artist": "Artist", "rank": -1}
    assert validate_song(song) is False


def test_string_rank_is_invalid():
    song = {"title": "Song", "artist": "Artist", "rank": "1"}
    assert validate_song(song) is False


def test_decimal_rank_is_invalid():
    song = {"title": "Song", "artist": "Artist", "rank": 1.5}
    assert validate_song(song) is False


def test_boolean_rank_is_invalid():
    song = {"title": "Song", "artist": "Artist", "rank": True}
    assert validate_song(song) is False


def test_none_input_is_invalid():
    assert validate_song(None) is False


def test_list_input_is_invalid():
    assert validate_song([]) is False


def test_unicode_title_and_artist_are_valid():
    song = {"title": "Déjà Vu", "artist": "Beyoncé", "rank": 2}
    assert validate_song(song) is True

#Snapshot Tests
#Make sample data
def make_snapshot():
    songs = []

    for rank in range(1, 101):
        song = {"title": "Song " + str(rank),"artist": "Artist","rank": rank}
        songs.append(song)

    snapshot = {"chart_name": "hot-100","chart_date": "2026-10-17","songs": songs}
    return snapshot


def test_valid_snapshot():
    snapshot = make_snapshot()

    # The test fails automatically if this raises an error
    validate_snapshot(snapshot)


def test_snapshot_with_invalid_date():
    snapshot = make_snapshot()
    snapshot["chart_date"] = "2026-02-30"

    error_found = False

    try:
        validate_snapshot(snapshot)
    except ValueError:
        error_found = True

    assert error_found is True


def test_snapshot_with_duplicate_ranks():
    snapshot = make_snapshot()
    snapshot["songs"][1]["rank"] = 1

    error_found = False

    try:
        validate_snapshot(snapshot)
    except ValueError:
        error_found = True

    assert error_found is True