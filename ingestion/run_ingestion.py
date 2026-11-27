import logging
from ingestion import fetch_charts
from ingestion import database
from ingestion.logging_config import setup_logging

logger = logging.getLogger(__name__)


def run_ingestion():
    chart_names = [
        "hot-100",
        "country-songs",
        "rock-songs",
        "pop-songs",
        "r-b-hip-hop-songs",
    ]

    failed = []

    for chart_name in chart_names:
        try:
            snapshot = fetch_charts.fetch_chart(chart_name)
        except Exception:
            logger.exception("Ingestion failed for chart %s while fetching", chart_name)
            failed.append(chart_name)
            continue

        try:
            saved_date = database.save_snapshot(snapshot)
        except Exception:
            logger.exception("Ingestion failed for chart %s while saving", chart_name)
            failed.append(chart_name)
            continue

        logger.info("%s snapshot saved for: %s", chart_name, saved_date)

    if failed:
        raise RuntimeError("Ingestion failed for: " + ", ".join(failed))



if __name__ == "__main__":
    setup_logging()
    run_ingestion()