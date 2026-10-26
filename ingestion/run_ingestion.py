from ingestion import fetch_charts
from ingestion import database


def run_ingestion():
    chart_names = [
        "hot-100",
        # "country-songs",
        # "rock-songs",
        # "pop-songs",
        # "r-b-hip-hop-songs",
    ]

    for chart_name in chart_names:
        snapshot = fetch_charts.fetch_chart(chart_name)
        saved_date = database.save_snapshot(snapshot)

        print(chart_name + " snapshot saved for:", saved_date)


if __name__ == "__main__":
    run_ingestion()