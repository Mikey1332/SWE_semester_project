from ingestion import fetch_charts
from ingestion import database


def main():
    snapshot = fetch_charts.fetch_chart("hot-100")
    saved_date = database.save_snapshot(snapshot)
    print("Snapshot saved for:", saved_date)

if __name__ == "__main__":
    main()