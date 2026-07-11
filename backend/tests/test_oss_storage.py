"""The artifact object store — Alibaba Cloud OSS backend + the local-disk fallback.

Proves the real OSS code path (oss2.Auth/Bucket → put_object/get_object) end-to-end with an in-memory
fake bucket (no network, no SDK install needed), the local fallback round-trips bytes, the singleton
selects the right backend from config, and the Forge <-> download contract reads both the new
storage-pointer shape and the legacy inline-base64 shape.
"""

from __future__ import annotations

import base64
import sys
import types

import pytest

from app.storage import oss as oss_mod
from app.storage.oss import (
    LocalArtifactStore,
    OSSArtifactStore,
    get_artifact_store,
    load_artifact_bytes,
    store_forged_content,
)

# --- a fake `oss2` so the OSS backend runs without the SDK or the network -------------------


class _FakeBucket:
    """In-memory stand-in for oss2.Bucket. Records the last headers so we can assert Content-Type."""

    def __init__(self, auth, endpoint, bucket_name):
        self.auth = auth
        self.endpoint = endpoint
        self.bucket_name = bucket_name
        self.store: dict[str, bytes] = {}
        self.last_headers: dict | None = None

    def put_object(self, key, data, headers=None):
        self.store[key] = bytes(data)
        self.last_headers = headers

    def get_object(self, key):
        payload = self.store[key]

        class _Result:
            def read(self_inner):
                return payload

        return _Result()


class _FakeAuth:
    def __init__(self, access_key_id, access_key_secret):
        self.access_key_id = access_key_id
        self.access_key_secret = access_key_secret


@pytest.fixture
def fake_oss2(monkeypatch):
    """Install a fake `oss2` module for the duration of a test (the lazy import picks it up)."""
    mod = types.ModuleType("oss2")
    mod.Auth = _FakeAuth
    mod.Bucket = _FakeBucket
    monkeypatch.setitem(sys.modules, "oss2", mod)
    yield mod


@pytest.fixture(autouse=True)
def _reset_singleton():
    """Each test gets a fresh store singleton (config/env differs case to case)."""
    oss_mod.reset_artifact_store()
    yield
    oss_mod.reset_artifact_store()


# --- local fallback ------------------------------------------------------------------------


async def test_local_store_roundtrips_bytes(tmp_path):
    store = LocalArtifactStore(str(tmp_path))
    data = b"%PDF-1.7 forged brief bytes"
    ptr = await store.put("art_x.pdf", data, "application/pdf")
    assert ptr.backend == "local"
    assert ptr.mime == "application/pdf"
    assert ptr.size == len(data)
    assert (tmp_path / "art_x.pdf").read_bytes() == data
    assert await store.get(ptr) == data


# --- OSS backend (fake bucket) -------------------------------------------------------------


async def test_oss_store_uses_oss2_put_and_get(fake_oss2):
    store = OSSArtifactStore(
        bucket_name="pack-artifacts",
        endpoint="https://oss-ap-southeast-1.aliyuncs.com",
        access_key_id="id",
        access_key_secret="secret",
        prefix="artifacts/",
    )
    data = b"forged docx bytes"
    ptr = await store.put("art_y.docx", data, "application/vnd.ms-word")

    # keyed under the prefix, and the object really landed in the (fake) bucket
    assert ptr.backend == "oss"
    assert ptr.key == "artifacts/art_y.docx"
    assert store._bucket.store["artifacts/art_y.docx"] == data
    # Content-Type header was set on upload
    assert store._bucket.last_headers == {"Content-Type": "application/vnd.ms-word"}
    # and it reads back out
    assert await store.get(ptr) == data


async def test_singleton_selects_oss_when_configured(fake_oss2, monkeypatch):
    monkeypatch.setattr("app.config.settings.oss_bucket", "pack-artifacts")
    monkeypatch.setattr(
        "app.config.settings.oss_endpoint", "https://oss-ap-southeast-1.aliyuncs.com"
    )
    monkeypatch.setattr("app.config.settings.oss_access_key_id", "id")
    monkeypatch.setattr("app.config.settings.oss_access_key_secret", "secret")
    monkeypatch.delenv("PACK_ARTIFACT_STORE", raising=False)
    oss_mod.reset_artifact_store()
    assert isinstance(get_artifact_store(), OSSArtifactStore)


async def test_singleton_defaults_to_local_when_unconfigured(monkeypatch):
    monkeypatch.setattr("app.config.settings.oss_bucket", "")
    oss_mod.reset_artifact_store()
    assert isinstance(get_artifact_store(), LocalArtifactStore)


async def test_force_local_env_overrides_oss(fake_oss2, monkeypatch):
    monkeypatch.setattr("app.config.settings.oss_bucket", "pack-artifacts")
    monkeypatch.setattr(
        "app.config.settings.oss_endpoint", "https://oss-ap-southeast-1.aliyuncs.com"
    )
    monkeypatch.setattr("app.config.settings.oss_access_key_id", "id")
    monkeypatch.setattr("app.config.settings.oss_access_key_secret", "secret")
    monkeypatch.setenv("PACK_ARTIFACT_STORE", "local")
    oss_mod.reset_artifact_store()
    assert isinstance(get_artifact_store(), LocalArtifactStore)


# --- the Forge <-> download contract -------------------------------------------------------


async def test_store_and_load_roundtrip_via_local(monkeypatch, tmp_path):
    monkeypatch.setattr("app.config.settings.oss_bucket", "")
    monkeypatch.setattr("app.config.settings.oss_local_dir", str(tmp_path))
    oss_mod.reset_artifact_store()

    data = b"forged pptx bytes"
    content = await store_forged_content("art_z.pptx", data, "application/vnd.ms-powerpoint")
    # new shape: a storage pointer, NOT inline base64
    assert "storage" in content and "b64" not in content
    assert content["storage"]["backend"] == "local"

    loaded = await load_artifact_bytes(content)
    assert loaded == (data, "application/vnd.ms-powerpoint")


async def test_store_forged_falls_back_to_inline_b64_on_store_error(monkeypatch):
    """A store failure must never sink a Forge write — it degrades to inline base64."""

    class _Boom(LocalArtifactStore):
        async def put(self, key, data, mime):  # noqa: ARG002
            raise RuntimeError("bucket on fire")

    monkeypatch.setattr(oss_mod, "get_artifact_store", lambda: _Boom("."))
    data = b"still downloadable"
    content = await store_forged_content("art_q.md", data, "text/markdown")

    assert "storage" not in content
    assert base64.b64decode(content["b64"]) == data
    # and the reader still round-trips the fallback shape
    assert await load_artifact_bytes(content) == (data, "text/markdown")


async def test_load_reads_legacy_inline_b64():
    """Rows written before the store existed (plain mime + b64) still download."""
    data = b"legacy artifact"
    content = {"mime": "application/pdf", "b64": base64.b64encode(data).decode()}
    assert await load_artifact_bytes(content) == (data, "application/pdf")


async def test_load_returns_none_for_non_file_content():
    """The final JSON brief (text/blocks, no bytes) is not a downloadable file."""
    assert await load_artifact_bytes({"text": "the brief", "blocks": []}) is None
