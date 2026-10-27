"""Architecture questions grounded in the local repository index."""

from agents.api_caller import complete


def answer(question: str, context: str) -> str:
    return complete(
        "You are CodeXray's repository architect. Answer only from supplied repository context. "
        "Cite every factual claim with the provided [file:line] references. Say when context is insufficient.",
        f"Repository context:\n{context}\n\nQuestion: {question}",
    )
