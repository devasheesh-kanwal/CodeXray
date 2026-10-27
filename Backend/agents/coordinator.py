"""Dispatch user requests to the appropriate CodeXray capability."""

from agents.architect import answer as architecture_answer
from agents.repair_agent import propose_repair
from agents.review_agent import review
from agents.worker import evaluate


def handle(task: str, question: str, context: str) -> dict:
    if task == "architecture":
        return {"task": task, "answer": architecture_answer(question, context)}
    if task == "review":
        return {"task": task, "review": review(question, context)}
    if task == "repair":
        return {"task": task, "proposal": propose_repair(question, context)}
    if task == "evaluate":
        return {"task": task, "evaluation": evaluate(question, context)}
    raise ValueError("task must be architecture, review, repair, or evaluate")
