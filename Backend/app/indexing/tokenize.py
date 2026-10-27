"""Code-aware tokenizer for BM25.

get_user_by_id -> get_user_by_id, get, user, by, id
getUserById    -> getuserbyid, get, user, by, id
Lowercased; Python keywords and 1-character tokens are dropped.
"""

import keyword
import re

IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
# 'HTTPServer' -> HTTP, Server ; 'parseHttpHeader' -> parse, Http, Header ; 'v2' -> v, 2
WORD_PART = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+")
STOPWORDS = {k.lower() for k in keyword.kwlist + keyword.softkwlist}


def split_identifier(identifier: str) -> list[str]:
    """Word parts of one identifier, lowercased."""
    return [part.lower() for piece in identifier.split("_") for part in WORD_PART.findall(piece)]


def tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for identifier in IDENTIFIER.findall(text):
        parts = split_identifier(identifier)
        candidates = [identifier.lower(), *parts] if len(parts) > 1 else [identifier.lower()]
        tokens += [t for t in candidates if len(t) > 1 and t not in STOPWORDS]
    return tokens
