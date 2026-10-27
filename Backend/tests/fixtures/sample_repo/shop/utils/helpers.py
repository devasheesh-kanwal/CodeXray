import re

HEADER_LINE = re.compile(r"^([^:]+):\s*(.*)$")


def parseHttpHeader(raw: str) -> dict[str, str]:
    """Parse 'Name: value' lines into a dict with lower-case names."""
    headers = {}
    for line in raw.splitlines():
        match = HEADER_LINE.match(line)
        if match:
            headers[match.group(1).lower()] = match.group(2)
    return headers
