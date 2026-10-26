from ingestion import fetch_charts
from ingestion import database


def run_ingestion():
    snapshot = fetch_charts.fetch_chart("hot-100")
    saved_date = database.save_snapshot(snapshot)
    print("Snapshot saved for:", saved_date)
    #for song in snapshot["songs"]:
    #    print(str(song["rank"]) + ". " + song["title"] + " by " + song["artist"])

if __name__ == "__main__":
    run_ingestion()