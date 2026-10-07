from pathlib import Path


def test_requirements_file_exists():
    ingestion_dir = Path(__file__).resolve().parents[1]
    assert (ingestion_dir / "requirements.txt").is_file()