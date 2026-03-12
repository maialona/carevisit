import logging
import sys
import os

os.makedirs("logs", exist_ok=True)

# Ensure StreamHandler writes to stdout and flushes immediately
stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setLevel(logging.INFO)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        stream_handler,
        logging.FileHandler("logs/app.log", encoding="utf-8")
    ],
    force=True
)

logger = logging.getLogger("carevisit")
