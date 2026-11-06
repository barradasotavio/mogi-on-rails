"""Serialize browser commands across this app's worktrees on the same host."""

import fcntl
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time


def main():
    command = sys.argv[1:]
    if command[:1] == ["--"]:
        command = command[1:]
    if not command:
        raise SystemExit("Usage: python3 scripts/run-browser.py -- <browser command>")

    lock_path = Path(tempfile.gettempdir()) / "mkw-on-rails-browser.lock"
    with lock_path.open("a") as lock:
        print("Waiting for the shared MKW browser slot…", flush=True)
        waiting = time.monotonic()
        fcntl.flock(lock, fcntl.LOCK_EX)
        # run-validation.mjs leaves this wait out of its budget.
        wait_file = os.environ.get("BROWSER_SLOT_WAIT_FILE")
        if wait_file:
            Path(wait_file).write_text(str(round((time.monotonic() - waiting) * 1000)))
        process = subprocess.Popen(command, start_new_session=True)

        def forward_signal(number, _frame):
            try:
                os.killpg(process.pid, number)
            except ProcessLookupError:
                pass

        for number in (signal.SIGINT, signal.SIGTERM):
            signal.signal(number, forward_signal)
        result = process.wait()
        return result if result >= 0 else 128 - result


if __name__ == "__main__":
    sys.exit(main())
