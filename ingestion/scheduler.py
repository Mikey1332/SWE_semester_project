import time
import schedule
from ingestion.run_ingestion import run_ingestion


def update_charts():
    print("Updating chart data...")

    try:
        run_ingestion()
    except Exception as error:
        print("Chart update failed:", error)


def main():
    print("[SCHEDULER RUNNING]")

    # Run once when the scheduler starts.
    update_charts()

    # Update charts every Wednesday at 2 PM.
    schedule.every().wednesday.at("14:00").do(update_charts)

    try:
        #Constant Loop
        while True:
            schedule.run_pending()
            # Wait 30 secs before checking again
            time.sleep(30)
    except KeyboardInterrupt:
        print("\nScheduler stopped.")


if __name__ == "__main__":
    main()