"""Atomic file writes that also work on Windows."""

import time
from pathlib import Path

RETRIES = 20
RETRY_DELAY_S = 0.05


def write_text_atomic(path: Path, text: str) -> None:
    """Write via a .tmp file and replace, so readers never see half a file.

    On Windows the replace fails with "Access is denied" while another request
    has the target open for reading (e.g. GET /status polling meta.json), so it
    is retried for up to ~1 s before giving up.
    """
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    for attempt in range(RETRIES):
        try:
            tmp.replace(path)
            return
        except PermissionError:
            if attempt == RETRIES - 1:
                raise
            time.sleep(RETRY_DELAY_S)
