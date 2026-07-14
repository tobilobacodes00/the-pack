# Incident replay fixtures

Golden-path fixtures (`../*.jsonl`) prove the happy flow and schema conformance. **These are
different**: each file here captures a real (or realistic) *incident* — a hostile input, a malformed
provider response, a Warden-triggering fault — so it becomes a permanent regression test. When
something bad happens in the wild, drop the captured payload here and it can never silently come back.

## Convention

- One file per incident, named `YYYY-MM-DD-short-description.json` (date it was captured/authored).
- Each file is a single JSON object with:
  - `kind` — the incident category the replay test dispatches on (e.g. `content_injection`).
  - `description` — one line: what happened / what it must not do.
  - `input` — the raw payload that triggered it (scraped text, a provider body, an event, …).
  - `expect` — assertions the replay test checks, shaped per `kind`.
- `tests/test_incident_replay.py` discovers every `*.json` here and replays it. Adding a fixture adds
  a test case automatically — no code change needed for a new incident of an existing `kind`.

## Adding a new kind

If an incident doesn't fit an existing `kind`, add a small `elif kind == "...":` branch in
`tests/test_incident_replay.py` that knows how to replay that category, then drop the fixture in.
Keep the branch tiny — the point is captured-payload → deterministic assertion, not a framework.
