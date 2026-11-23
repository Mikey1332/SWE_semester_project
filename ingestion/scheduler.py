import logging
import time
import schedule
from ingestion.logging_config import setup_logging
from ingestion.run_ingestion import run_ingestion

logger = logging.getLogger(__name__)


def update_charts():
    logger.info("Updating chart data...")
    print("Updating chart data...")

    try:
        run_ingestion()
    except Exception as error:
        print("Chart update failed:", error)
        logger.exception("Chart update failed")


def main():
    setup_logging()
    print("[SCHEDULER RUNNING]\n")
    logger.info("Scheduler running")

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
        print("\n[SCHEDULER STOPPED]")
        logger.info("Scheduler stopped")


if __name__ == "__main__":
    main()