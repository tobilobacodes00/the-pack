"""Paraphrase-tolerant claim matching — shared by the Sentinel's critique (supervisor) and the
Receipts join. Lives here, not on the Supervisor, so the Receipts don't reach into its privates."""

from __future__ import annotations

import re
from collections.abc import Set as AbstractSet

_CRITIQUE_STOPWORDS = frozenset(
    "a an and are as at be but by for from has have in into is it its of on or that the their this to "
    "was were will with not no's these those which who whose what when where why how than then over "
    "under about between within across per each all any some more most less least may might can could "
    "would should about only also just very".split()
)

# A flagged claim is "the same" as a merge claim when this fraction of its content tokens are covered.
# 0.75 clears a real paraphrase without catching claims that merely share a couple task words.
_CRITIQUE_MATCH_COVERAGE = 0.75


def content_tokens(text: str, extra_stop: AbstractSet[str] = frozenset()) -> set[str]:
    """Lowercase word tokens minus stopwords and any extra (task-topic) words, for overlap matching."""
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {w for w in words if w not in _CRITIQUE_STOPWORDS and w not in extra_stop and len(w) > 1}


def claim_matches(issue_claim: str, merge_claim: str, task_stop: AbstractSet[str]) -> bool:
    """Paraphrase-tolerant 'these name the same claim' test: True when the flagged claim's content
    tokens are >= _CRITIQUE_MATCH_COVERAGE covered by the merge claim's tokens."""
    issue_tokens = content_tokens(issue_claim, task_stop)
    if not issue_tokens:
        return False
    merge_tokens = content_tokens(merge_claim, task_stop)
    covered = len(issue_tokens & merge_tokens) / len(issue_tokens)
    return covered >= _CRITIQUE_MATCH_COVERAGE
