import logging

import pytest

from ingestion import run_ingestion as run_module


def test_one_failing_chart_does_not_stop_the_rest(monkeypatch, caplog):
    saved = []

    def fake_fetch(chart_name):
        if chart_name == "hot-100":
            raise ValueError("bad chart")
        return chart_name

    def fake_save(snapshot):
        saved.append(snapshot)
        return "2026-11-21"

    monkeypatch.setattr(run_module.fetch_charts, "fetch_chart", fake_fetch)
    monkeypatch.setattr(run_module.database, "save_snapshot", fake_save)

    with caplog.at_level(logging.ERROR):
        with pytest.raises(RuntimeError, match="hot-100"):
            run_module.run_ingestion()

    assert saved == ["country-songs", "rock-songs", "pop-songs", "r-b-hip-hop-songs"]
    assert "hot-100" in caplog.text