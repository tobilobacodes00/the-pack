"""deep_scout — the opt-in bounded tool-loop (the study's architecture bet). These prove the loop is
SAFE by construction: it respects the hard iteration cap, emits a tool_selected event per turn, routes
every move through the injected dispatch/tools (so the Supervisor keeps gating + accounting), and
terminates cleanly on finish / cap / malformed decision. Fully offline via FakeQwen's deep_scout_step
script — no key needed."""

from __future__ import annotations

from app.engine.deep_scout import DEEP_SCOUT_STEP_SCHEMA, run_deep_scout


class _Recorder:
    def __init__(self, decisions: list[dict]):
        self.decisions = decisions
        self.dispatch_calls = 0
        self.searches: list[str] = []
        self.fetches: list[str] = []
        self.selected: list[tuple[int, str, str]] = []

    async def dispatch(self, context: str) -> dict:
        d = self.decisions[min(self.dispatch_calls, len(self.decisions) - 1)]
        self.dispatch_calls += 1
        return d

    async def search(self, query: str) -> list[dict]:
        self.searches.append(query)
        return [{"title": f"hit for {query}", "url": "https://example.com/1"}]

    async def fetch(self, url: str) -> str:
        self.fetches.append(url)
        return f"full text of {url}"

    async def emit_selected(self, iteration: int, tool: str, args: str) -> None:
        self.selected.append((iteration, tool, args))


async def _run(rec: _Recorder, *, max_iterations: int = 3):
    return await run_deep_scout(
        task="the topic",
        max_iterations=max_iterations,
        dispatch=rec.dispatch,
        search=rec.search,
        fetch=rec.fetch,
        emit_selected=rec.emit_selected,
    )


async def test_full_arc_search_then_fetch_then_finish() -> None:
    rec = _Recorder(
        [
            {"action": "search", "query": "the topic overview"},
            {"action": "fetch", "url": "https://example.com/1"},
            {"action": "finish", "summary": "done, gathered enough"},
        ]
    )
    result = await _run(rec)
    assert result.stopped_reason == "finished"
    assert result.summary == "done, gathered enough"
    assert result.iterations == 3
    assert rec.searches == ["the topic overview"]
    assert rec.fetches == ["https://example.com/1"]
    # The fetched text is attached to the gathered hit (marked read).
    assert any(h.get("text") for h in result.hits)
    # One tool_selected per turn, in order.
    assert [s[1] for s in rec.selected] == ["search", "fetch", "finish"]


async def test_hard_iteration_cap_bounds_the_loop() -> None:
    """A wolf that NEVER says finish must still stop at the cap — the runaway guard. It must make
    exactly `max_iterations` dispatches, no more."""
    rec = _Recorder([{"action": "search", "query": "again"}])  # always searches, never finishes
    result = await _run(rec, max_iterations=3)
    assert result.iterations == 3
    assert rec.dispatch_calls == 3  # never exceeds the cap — cost is bounded
    assert result.stopped_reason == "cap_reached"
    assert result.summary  # a neutral cap summary, not empty


async def test_malformed_decision_stops_instead_of_spinning() -> None:
    """A garbage/empty decision (a model that returned nonsense) must be treated as a safe finish, not
    an infinite loop or a crash."""
    rec = _Recorder([{"action": "banana"}])
    result = await _run(rec)
    assert result.stopped_reason == "no_action"
    assert result.iterations == 1


async def test_every_move_goes_through_the_injected_seams() -> None:
    """The loop must never reach a tool or the model directly — only via the injected callables (so
    the Supervisor keeps gating/accounting). Proven by: no search/fetch happens without a dispatch
    decision driving it."""
    rec = _Recorder([{"action": "finish", "summary": "nothing needed"}])
    result = await _run(rec)
    assert rec.dispatch_calls == 1
    assert rec.searches == [] and rec.fetches == []
    assert result.stopped_reason == "finished"


def test_step_schema_is_well_formed() -> None:
    from jsonschema import Draft202012Validator

    Draft202012Validator.check_schema(DEEP_SCOUT_STEP_SCHEMA)


async def test_fakeqwen_scripts_the_deep_scout_step_arc() -> None:
    """FakeQwen's deep_scout_step handler must drive the search→fetch→finish arc deterministically off
    the running context (it's stateless), so the whole loop runs offline. Wire the loop's dispatch to a
    real FakeQwen call and confirm it terminates with a finish."""
    from app.qwen.fake import FakeQwen
    from app.qwen.types import CallSpec

    fake = FakeQwen()

    async def dispatch(context: str) -> dict:
        result = await fake.complete(
            CallSpec(
                hunt_id="h",
                wolf_id="deep-scout-1",
                tier="plus",
                intent="deep_scout_step",
                response_schema=DEEP_SCOUT_STEP_SCHEMA,
                messages=[{"role": "user", "content": f"Task: the topic\n\n{context}"}],
            )
        )
        return result.parsed or {}

    rec = _Recorder([])
    rec.dispatch = dispatch  # type: ignore[method-assign]
    result = await run_deep_scout(
        task="the topic",
        max_iterations=3,
        dispatch=dispatch,
        search=rec.search,
        fetch=rec.fetch,
        emit_selected=rec.emit_selected,
    )
    assert result.stopped_reason == "finished"
    assert rec.searches and rec.fetches  # it genuinely searched then fetched before finishing
