"""A soft cap on the context string a dispatch sends the model.

The pack never builds a growing multi-turn message history to compact (each dispatch is one
system+user call, built fresh — see `Supervisor._messages`). The equivalent risk is the CONTEXT
STRING inside that one user message growing unbounded as a hunt gets wider or the knowledge base
grows. `fit_context` bounds it: drop whole lowest-priority parts first (never split one), and
only as a last resort truncate the tail of what's left at a paragraph/line boundary with an
explicit marker — so the model never sees a payload cut off mid-entry.

`estimate_tokens` is a cheap chars/4 heuristic, not a real tokenizer count — it's a safety
margin against the model's actual context window, not a billing figure (Qwen's real tokenizer
isn't tiktoken, so an exact count isn't cheaply achievable anyway).
"""

from __future__ import annotations


def estimate_tokens(text: str) -> int:
    return len(text) // 4 + 1


def _truncate_at_boundary(text: str, max_chars: int) -> str:
    """Cut `text` to at most `max_chars`, preferring a paragraph break, then a line break, so an
    entry (a finding, a source line) is never split in half."""
    max_chars = max(0, max_chars)
    if len(text) <= max_chars:
        return text
    cut = text.rfind("\n\n", 0, max_chars)
    if cut == -1:
        cut = text.rfind("\n", 0, max_chars)
    if cut == -1:
        cut = max_chars
    return text[:cut].rstrip()


def fit_context(parts: list[str], budget_tokens: int) -> str:
    """Join non-empty `parts` (already in priority order, highest first) with a blank line,
    dropping whole parts from the END (lowest priority) until the result fits `budget_tokens`.
    If even the single remaining (highest-priority) part alone is over budget, truncate its tail
    at a paragraph/line boundary and mark it — never silently drop the rest, never split an
    entry mid-line."""
    kept = [p for p in parts if p and p.strip()]
    if not kept:
        return ""

    while len(kept) > 1 and estimate_tokens("\n\n".join(kept)) > budget_tokens:
        kept.pop()

    joined = "\n\n".join(kept)
    if estimate_tokens(joined) <= budget_tokens:
        return joined

    max_chars = budget_tokens * 4
    truncated = _truncate_at_boundary(joined, max_chars)
    return f"{truncated}\n…[truncated]"
