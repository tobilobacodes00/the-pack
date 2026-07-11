"""Query hygiene for the scouts' web search — pure, model-free string helpers.

Extracted from the Supervisor so the hunt loop isn't carrying regex/keyword plumbing. `plain_query`
degrades a Google-style "dork" to plain keywords (the search vendors take natural language, not
operators); `broaden` builds a shorter, plainer query for a scout's second attempt when the first
came back dry, keeping each scout on its own angle so the pack's sources stay diverse.
"""

from __future__ import annotations

import re

# Search APIs (Tavily/Exa/Serp/…) take natural language, not Google dorks — a query like
# "site:spacex.com OR site:nsf.org past week" returns nothing because the operators are read as
# literal text. Degrade any dork to plain keywords so the fan-out actually finds sources; recency is
# the engines' job, not a phrase in the query.
_DORK_RE = re.compile(
    r"""(?ix)
      \b(?:site|filetype|intitle|inurl|intext)\s*:\s*\S+   # site:foo.com, filetype:pdf, …
    | \b(?:OR|AND)\b                                        # boolean operators
    | \b(?:past|last)\s+(?:\d+\s+)?(?:day|week|month|year)s?\b   # recency phrases
    | ["']                                                  # stray quotes
    """,
)


def plain_query(query: str) -> str:
    """Strip search operators and recency phrases down to plain keywords. Falls back to the original
    if stripping empties it (better a dork than nothing)."""
    cleaned = _DORK_RE.sub(" ", query)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -|")
    return cleaned or query.strip()


# Filler dropped when broadening a dry scout query — articles/connectors + doc-shaped noise words
# that narrow a search without adding topic signal ("release notes", "documentation", "github"...).
_BROADEN_STOP = frozenset(
    {
        "the",
        "a",
        "an",
        "and",
        "or",
        "of",
        "for",
        "to",
        "in",
        "on",
        "with",
        "its",
        "their",
        "is",
        "are",
        "release",
        "notes",
        "documentation",
        "docs",
        "overview",
        "guide",
        "github",
        "official",
        "latest",
        "key",
        "facts",
    }
)


def broaden(task: str, query: str) -> str:
    """A shorter, plainer query for a scout's SECOND attempt when its first came back dry: the task
    subject's keywords plus the angle's most distinctive ones, capped short. Deterministic (no model
    call). Keeps each scout on ITS OWN angle so the pack's sources stay diverse."""
    subject = [w for w in plain_query(task).split() if w.lower() not in _BROADEN_STOP][:4]
    have = {w.lower() for w in subject}
    extra = [
        w
        for w in plain_query(query).split()
        if w.lower() not in have and w.lower() not in _BROADEN_STOP
    ][:3]
    return " ".join(subject + extra) or plain_query(query) or task
