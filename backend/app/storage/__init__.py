"""Object storage for forged artifacts — Alibaba Cloud OSS, with a local-disk fallback."""

from __future__ import annotations

from app.storage.oss import (
    ArtifactStore,
    LocalArtifactStore,
    OSSArtifactStore,
    StoragePointer,
    get_artifact_store,
    load_artifact_bytes,
    store_forged_content,
)

__all__ = [
    "ArtifactStore",
    "LocalArtifactStore",
    "OSSArtifactStore",
    "StoragePointer",
    "get_artifact_store",
    "load_artifact_bytes",
    "store_forged_content",
]
