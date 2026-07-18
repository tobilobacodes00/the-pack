"""Artifact object store — Alibaba Cloud OSS (Object Storage Service), with a local-disk fallback.

Forged files — the PDF/DOCX/PPTX/PNG/… the Howler makes — are large binary blobs. Rather than
inline them as base64 inside a Postgres JSON column forever, we push the bytes to an OSS bucket and
keep only a small pointer in the DB. Downloads stream the object back out of OSS.

Design:
- `ArtifactStore` is the seam: `put(key, data, mime) -> StoragePointer` and `get(pointer) -> bytes`.
- `OSSArtifactStore` talks to Alibaba OSS via the official `oss2` SDK. `oss2` is synchronous, so
  every call runs in a worker thread (`asyncio.to_thread`) to stay off the event loop.
- `LocalArtifactStore` writes to disk — the fallback whenever the `OSS_*` settings are unset, so the
  engine runs end-to-end with zero cloud configuration. A `StoragePointer` records which backend
  wrote it, so reads route correctly even if the config later changes.

`get_artifact_store()` is a process singleton that picks OSS when fully configured, else local.
Callers treat a store failure as non-fatal: the Forge write path falls back to inlining base64 so a
misconfigured bucket never sinks a hunt.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.config import settings


@dataclass(frozen=True)
class StoragePointer:
    """Where an artifact's bytes live. Persisted (as a dict) in the artifact row's `content`.

    `backend` is "oss" or "local"; `key` is the object key / relative path. `mime` and `size` let a
    download set headers without re-reading the object first.
    """

    backend: str
    key: str
    mime: str
    size: int

    def to_dict(self) -> dict[str, Any]:
        return {"backend": self.backend, "key": self.key, "mime": self.mime, "size": self.size}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> StoragePointer:
        return cls(
            backend=str(d.get("backend", "")),
            key=str(d.get("key", "")),
            mime=str(d.get("mime", "application/octet-stream")),
            size=int(d.get("size", 0)),
        )


class ArtifactStore:
    """The storage seam. Two concrete backends: OSS (Alibaba Cloud) and local disk."""

    backend: str = "abstract"

    async def put(self, key: str, data: bytes, mime: str) -> StoragePointer:
        raise NotImplementedError

    async def get(self, pointer: StoragePointer) -> bytes:
        raise NotImplementedError


class LocalArtifactStore(ArtifactStore):
    """Disk-backed fallback. Bytes land under `root/<key>`; the key is the artifact id + format."""

    backend = "local"

    def __init__(self, root: str) -> None:
        self._root = Path(root)

    async def put(self, key: str, data: bytes, mime: str) -> StoragePointer:
        def _write() -> None:
            path = self._root / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

        await asyncio.to_thread(_write)
        return StoragePointer(backend=self.backend, key=key, mime=mime, size=len(data))

    async def get(self, pointer: StoragePointer) -> bytes:
        return await asyncio.to_thread((self._root / pointer.key).read_bytes)


class OSSArtifactStore(ArtifactStore):
    """Alibaba Cloud OSS backend. Objects live at `<prefix><key>` in the configured bucket.

    Uses the `oss2` SDK (`put_object` / `get_object`); sync calls run in worker threads so they
    never block the event loop.
    """

    backend = "oss"

    def __init__(
        self,
        *,
        bucket_name: str,
        endpoint: str,
        access_key_id: str,
        access_key_secret: str,
        prefix: str = "",
    ) -> None:
        import oss2  # imported lazily — only needed when OSS is actually configured

        auth = oss2.Auth(access_key_id, access_key_secret)
        self._bucket = oss2.Bucket(auth, endpoint, bucket_name)
        self._prefix = prefix

    def _object_key(self, key: str) -> str:
        return f"{self._prefix}{key}"

    async def put(self, key: str, data: bytes, mime: str) -> StoragePointer:
        object_key = self._object_key(key)

        def _upload() -> None:
            self._bucket.put_object(object_key, data, headers={"Content-Type": mime})

        await asyncio.to_thread(_upload)
        return StoragePointer(backend=self.backend, key=object_key, mime=mime, size=len(data))

    async def get(self, pointer: StoragePointer) -> bytes:
        def _download() -> bytes:
            return self._bucket.get_object(pointer.key).read()

        return await asyncio.to_thread(_download)


def _oss_configured() -> bool:
    """True only when every credential OSS needs is present; otherwise stay on local disk."""
    return all(
        (
            settings.oss_bucket,
            settings.oss_endpoint,
            settings.oss_access_key_id,
            settings.oss_access_key_secret,
        )
    )


_store: ArtifactStore | None = None


def get_artifact_store() -> ArtifactStore:
    """Process-wide singleton. OSS when fully configured, else the local-disk fallback.

    `PACK_ARTIFACT_STORE=local` forces the fallback even when OSS creds are present (used by tests
    and offline demos so a stray env var can't drag a run onto the network)."""
    global _store
    if _store is not None:
        return _store
    forced_local = os.environ.get("PACK_ARTIFACT_STORE", "").lower() == "local"
    if _oss_configured() and not forced_local:
        _store = OSSArtifactStore(
            bucket_name=settings.oss_bucket,
            endpoint=settings.oss_endpoint,
            access_key_id=settings.oss_access_key_id,
            access_key_secret=settings.oss_access_key_secret,
            prefix=settings.oss_prefix,
        )
    else:
        _store = LocalArtifactStore(settings.oss_local_dir)
    return _store


def reset_artifact_store() -> None:
    """Drop the cached singleton (tests that flip config/env between cases)."""
    global _store
    _store = None


# --- the Forge <-> download contract ---------------------------------------------------
#
# A forged artifact's DB `content` is one of two shapes, and the download route reads both:
#   { "storage": {backend, key, mime, size} }   ← current: bytes live in OSS or on disk
#   { "mime": ..., "b64": ... }                 ← legacy / fallback: bytes inline in Postgres
# `store_forged_content` writes the first shape (falling back to the second if the store errors);
# `load_artifact_bytes` reads either.


async def store_forged_content(key: str, data: bytes, mime: str) -> dict[str, Any]:
    """Push forged bytes to the artifact store and return the `content` dict to persist.

    Non-fatal: if the store raises (e.g. a misconfigured bucket), fall back to inlining base64 so a
    Forge write never sinks a hunt."""
    import base64

    try:
        pointer = await get_artifact_store().put(key, data, mime)
        return {"storage": pointer.to_dict()}
    except Exception:  # noqa: BLE001 — store failure degrades to inline b64, never blocks the hunt
        return {"mime": mime, "b64": base64.b64encode(data).decode()}


async def load_artifact_bytes(content: dict[str, Any]) -> tuple[bytes, str] | None:
    """Resolve an artifact `content` dict to `(bytes, mime)`, or None if it holds no file.

    Handles both the storage-pointer shape and the legacy inline-b64 shape."""
    import base64

    ptr = content.get("storage")
    if isinstance(ptr, dict):
        pointer = StoragePointer.from_dict(ptr)
        data = await get_artifact_store().get(pointer)
        return data, pointer.mime
    b64 = content.get("b64")
    if b64:
        return base64.b64decode(b64), content.get("mime", "application/octet-stream")
    return None
