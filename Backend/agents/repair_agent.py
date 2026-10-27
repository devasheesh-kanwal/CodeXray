"""Generate a bounded repair proposal for human review."""

from agents.api_caller import complete


def propose_repair(task: str, context: str) -> str:
    return complete(
        "You are CodeXray's repair agent. Diagnose the issue using only supplied context. "
        "Return a concise diagnosis and a unified diff proposal. Never claim to have applied, "
        "tested, or merged a change. The proposal requires human approval.",
        f"Issue:\n{task}\n\nRepository context:\n{context}",
    )
