import logging
import time
import schedule
from ingestion.logging_config import setup_logging
from ingestion.run_ingestion import run_ingestion

logger = logging.getLogger(__name__)


def update_charts():
    logger.info("Updating chart data...")

    try:
        run_ingestion()
    except Exception as error:
        logger.exception("Chart update failed")


def main():
    setup_logging()
    logger.info("[SCHEDULER RUNNING]")

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
        logger.info("[SCHEDULER STOPPED]")


if __name__ == "__main__":
    main()