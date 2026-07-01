import json
import os
import sys
from datetime import datetime

LOG_FILE = "runtime/logs/events.jsonl"

os.makedirs("runtime/logs", exist_ok=True)


class Logger:
    COLORS = {
        "INFO": "\033[92m",
        "WARN": "\033[93m",
        "ERROR": "\033[91m",
    }

    RESET = "\033[0m"

    def _write(self, level, module, message):
        entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": level,
            "module": module,
            "message": message,
        }

        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(entry) + "\n")

        color = self.COLORS.get(level, "")
        print(f"{color}[{level}] [{module}] {message}{self.RESET}")


logger = Logger()
