import logging
import os
from logging.handlers import RotatingFileHandler

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def setup_logging():
    """Send log lines to the terminal, and to a file if INGESTION_LOG_FILE is set."""
    root = logging.getLogger()
    if root.handlers:  # already configured
        return

    root.setLevel(logging.INFO)
    formatter = logging.Formatter(LOG_FORMAT)

    console = logging.StreamHandler()
    console.setFormatter(formatter)
    root.addHandler(console)

    log_file = os.environ.get("INGESTION_LOG_FILE")
    if log_file:
        file_handler = RotatingFileHandler(log_file, maxBytes=1_000_000, backupCount=3)
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)