"""Evaluate a proposed change; this agent does not execute repository code."""

from agents.api_caller import complete


def evaluate(change: str, results: str) -> str:
    return complete(
        "You are CodeXray's evaluation worker. Assess the supplied diff and test/lint output. "
        "Report concrete risks and whether evidence supports passing the evaluation gate. "
        "Do not claim to run tests yourself.",
        f"Proposed change:\n{change}\n\nEvaluation output:\n{results}",
    )
