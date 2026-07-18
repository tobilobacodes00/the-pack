"""Warden + Stray healing — the anomaly-recovery path, lifted out of the Supervisor.

When a wolf faults (timeout, repeat failure, oversized context, …), the engine narrates a Stray and
dispatches a roaming Warden to heal it (a reroute); the Warden clones itself to tend several faults at
once (capped at 3). This class owns only the healing bookkeeping — which wolves faulted and which
Wardens exist. It emits through the Supervisor's single Emitter and spawns through the Supervisor's
spawn primitive (both injected), so seq assignment and the roster stay in one place.

Wire note: events stay `doctor_dispatched` / `doctor_healed` with a `doctor_id` payload key — the
event schema is FROZEN, so the Warden rides the existing types; `doctor_id` carries the Warden's id
(`warden`, `warden-2`, …).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

EmitFn = Callable[[str, str, dict], Awaitable[None]]
SpawnFn = Callable[..., Awaitable[str]]  # (role, *, parent=None) -> wolf_id


class Healer:
    # The Warden is a STANDING pack member spawned by the roster at hunt start — the Healer ADOPTS it
    # (`warden`) rather than spawning a duplicate. Only OVERFLOW wardens are spawned as clones.
    _STANDING_WARDEN = "warden"

    def __init__(self, emit: EmitFn, spawn_wolf: SpawnFn) -> None:
        self._emit = emit
        self._spawn_wolf = spawn_wolf
        self._wardens: list[
            str
        ] = []  # Wardens available to heal (standing one adopted on first use)
        self._faulted: set[str] = set()  # wolves the Warden has been sent to heal

    async def _ensure_warden(self) -> str:
        """A Warden roams to heal a fault; it clones itself to tend several at once (capped). The
        first Warden is the STANDING one already on the canvas (adopted, not re-spawned). Returns
        the Warden handling the latest fault."""
        need = max(1, min(len(self._faulted), 3))
        if not self._wardens:
            # Adopt the standing Warden the roster already spawned — it's the one that roams to heal.
            self._wardens.append(self._STANDING_WARDEN)
        while len(self._wardens) < need:
            self._wardens.append(await self._spawn_wolf("warden", parent=self._wardens[0]))
        return self._wardens[-1]

    async def heal_with_warden(self, target_wolf_id: str, pattern: str) -> None:
        """The Warden is dispatched to a faulted wolf and heals it (reroute). Layered on top of the
        Stray path — the Stray still fires; the Warden is the visible healer. Emitted on the frozen
        `doctor_*` event types, with `doctor_id` carrying the Warden's id."""
        self._faulted.add(target_wolf_id)
        warden_id = await self._ensure_warden()
        await self._emit(
            "doctor_dispatched",
            warden_id,
            {"doctor_id": warden_id, "target_wolf_id": target_wolf_id, "reason": pattern},
        )
        note = {
            "repeat_fail": f"{warden_id} patched {target_wolf_id} after it kept hitting dead ends.",
            "loop": f"{warden_id} reset {target_wolf_id}'s angle — it was circling.",
            "timeout": f"{warden_id} pulled {target_wolf_id} back after it stalled.",
            "provider_error": f"{warden_id} stood {target_wolf_id} down — model unavailable.",
            "size_exceeded": f"{warden_id} trimmed {target_wolf_id}'s context — it grew too large.",
        }.get(pattern, f"{warden_id} healed {target_wolf_id} and the pack moved on.")
        await self._emit(
            "doctor_healed",
            warden_id,
            {
                "doctor_id": warden_id,
                "target_wolf_id": target_wolf_id,
                "action": "reroute",
                "note_plain_english": note,
            },
        )

    async def stray_event(self, wolf_id: str, pattern: str, evidence_ref: str | None) -> None:
        """Narrate a Stray and the recovery. The Warden performs the heal; the hunt stays 'hunting'."""
        await self._emit(
            "stray_detected",
            "engine",
            {
                "wolf_id": wolf_id,
                "pattern": pattern,
                "evidence_ref": evidence_ref or f"art_{wolf_id}_stray",
            },
        )
        await self.heal_with_warden(wolf_id, pattern)  # the Warden roams in to heal the fault
        note = {
            "repeat_fail": f"{wolf_id} kept hitting dead ends — the Warden rerouted it.",
            "loop": f"{wolf_id} was circling the same ground — the Warden reset its angle.",
            "timeout": f"{wolf_id} stalled — the Warden pulled it back and the pack moved on.",
            "provider_error": f"{wolf_id} stood down — the model was briefly unavailable.",
            "size_exceeded": f"{wolf_id}'s context grew too large — the Warden trimmed it back.",
        }.get(pattern, f"{wolf_id} went off track — the Warden recovered the hunt.")
        await self._emit(
            "stray_recovered",
            "engine",
            {"wolf_id": wolf_id, "action": "reroute", "note_plain_english": note},
        )
