"""Review diffs for bugs, security issues, and design concerns."""

from agents.api_caller import complete


def review(diff: str, context: str = "") -> str:
    return complete(
        "You are CodeXray's pull request reviewer. Look for actionable bugs, security risks, "
        "and design problems. Prioritize findings and cite file and line where possible. "
        "If there are no findings, say so and mention any limits in the supplied context.",
        f"Diff or review request:\n{diff}\n\nAdditional repository context:\n{context}",
    )
