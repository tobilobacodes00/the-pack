"""Doctor + Stray healing — the anomaly-recovery path, lifted out of the Supervisor.

When a wolf faults (timeout, repeat failure, oversized context, …), the engine narrates a Stray and
dispatches a roaming Doctor to heal it (a reroute); the Doctor clones itself to tend several faults at
once (capped at 3). This class owns only the healing bookkeeping — which wolves faulted and which
Doctors exist. It emits through the Supervisor's single Emitter and spawns through the Supervisor's
spawn primitive (both injected), so seq assignment and the roster stay in one place.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

EmitFn = Callable[[str, str, dict], Awaitable[None]]
SpawnFn = Callable[..., Awaitable[str]]  # (role, *, parent=None) -> wolf_id


class Healer:
    def __init__(self, emit: EmitFn, spawn_wolf: SpawnFn) -> None:
        self._emit = emit
        self._spawn_wolf = spawn_wolf
        self._doctors: list[str] = []  # spawned Doctors (clone to heal several at once)
        self._faulted: set[str] = set()  # wolves the Doctor has been sent to heal

    async def _ensure_doctor(self) -> str:
        """A Doctor roams to heal a fault; it clones itself to tend several at once (capped). Returns
        the Doctor handling the latest fault."""
        need = max(1, min(len(self._faulted), 3))
        while len(self._doctors) < need:
            parent = self._doctors[0] if self._doctors else None
            self._doctors.append(await self._spawn_wolf("doctor", parent=parent))
        return self._doctors[-1]

    async def heal_with_doctor(self, target_wolf_id: str, pattern: str) -> None:
        """The Doctor is dispatched to a faulted wolf and heals it (reroute). Layered on top of the
        Stray path — the Stray still fires; the Doctor is the visible healer."""
        self._faulted.add(target_wolf_id)
        doctor_id = await self._ensure_doctor()
        await self._emit(
            "doctor_dispatched",
            doctor_id,
            {"doctor_id": doctor_id, "target_wolf_id": target_wolf_id, "reason": pattern},
        )
        note = {
            "repeat_fail": f"{doctor_id} patched {target_wolf_id} after it kept hitting dead ends.",
            "loop": f"{doctor_id} reset {target_wolf_id}'s angle — it was circling.",
            "timeout": f"{doctor_id} pulled {target_wolf_id} back after it stalled.",
            "provider_error": f"{doctor_id} stood {target_wolf_id} down — model unavailable.",
            "size_exceeded": f"{doctor_id} trimmed {target_wolf_id}'s context — it grew too large.",
        }.get(pattern, f"{doctor_id} healed {target_wolf_id} and the pack moved on.")
        await self._emit(
            "doctor_healed",
            doctor_id,
            {
                "doctor_id": doctor_id,
                "target_wolf_id": target_wolf_id,
                "action": "reroute",
                "note_plain_english": note,
            },
        )

    async def stray_event(self, wolf_id: str, pattern: str, evidence_ref: str | None) -> None:
        """Narrate a Stray and the recovery. The Doctor performs the heal; the hunt stays 'hunting'."""
        await self._emit(
            "stray_detected",
            "engine",
            {
                "wolf_id": wolf_id,
                "pattern": pattern,
                "evidence_ref": evidence_ref or f"art_{wolf_id}_stray",
            },
        )
        await self.heal_with_doctor(wolf_id, pattern)  # the Doctor roams in to heal the fault
        note = {
            "repeat_fail": f"{wolf_id} kept hitting dead ends — Alpha rerouted it.",
            "loop": f"{wolf_id} was circling the same ground — Alpha reset its angle.",
            "timeout": f"{wolf_id} stalled — Alpha pulled it back and the pack moved on.",
            "provider_error": f"{wolf_id} stood down — the model was briefly unavailable.",
            "size_exceeded": f"{wolf_id}'s context grew too large — Alpha trimmed it back.",
        }.get(pattern, f"{wolf_id} went off track — Alpha recovered the hunt.")
        await self._emit(
            "stray_recovered",
            "engine",
            {"wolf_id": wolf_id, "action": "reroute", "note_plain_english": note},
        )
