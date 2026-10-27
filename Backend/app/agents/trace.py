"""Build the API's agent_trace ([{agent, step, action, summary, ms}]) from run events."""

from app.api.schemas.common import AgentTraceStep
from app.agents.state import RunState


def build_agent_trace(state: RunState) -> list[AgentTraceStep]:
    """One trace step per tool use, agent output and agent error, in run order.

    Plain-code agents (e.g. the Citation checker) appear too when they emit
    an agent_output event.
    """
    trace: list[AgentTraceStep] = []
    for event in state.events:
        if event.kind == "tool_result":
            action = event.data.get("tool", "tool")
        elif event.kind == "agent_output":
            action = "output"
        elif event.kind == "agent_error":
            action = "error"
        else:
            continue
        trace.append(
            AgentTraceStep(
                agent=event.agent or "coordinator",
                step=len(trace) + 1,
                action=action,
                summary=event.summary,
                ms=event.ms or 0,
            )
        )
    return trace
