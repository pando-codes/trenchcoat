import base64
import pytest
import respx
import httpx
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes, serialization
from trenchcoat_copilot_extension.github_auth import (
    fetch_github_public_keys,
    verify_github_signature,
)


def _make_key_pair():
    priv = ec.generate_private_key(ec.SECP256R1())
    pub = priv.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return priv, pub


def _sign(private_key, payload: bytes) -> str:
    sig = private_key.sign(payload, ec.ECDSA(hashes.SHA256()))
    return base64.b64encode(sig).decode()


def test_valid_signature_passes():
    priv, pub = _make_key_pair()
    payload = b'{"messages":[]}'
    sig = _sign(priv, payload)
    keys = {"key-id-1": pub}
    assert verify_github_signature(payload, "key-id-1", sig, keys) is True


def test_tampered_payload_fails():
    priv, pub = _make_key_pair()
    payload = b'{"messages":[]}'
    sig = _sign(priv, payload)
    keys = {"key-id-1": pub}
    assert verify_github_signature(b"tampered", "key-id-1", sig, keys) is False


def test_bad_signature_fails():
    _, pub = _make_key_pair()
    keys = {"key-id-1": pub}
    bad_sig = base64.b64encode(b"not-a-real-signature").decode()
    assert verify_github_signature(b"payload", "key-id-1", bad_sig, keys) is False


def test_unknown_key_id_fails():
    keys = {}
    assert verify_github_signature(b"payload", "missing-id", "sig", keys) is False


@pytest.mark.asyncio
@respx.mock
async def test_fetch_github_public_keys_returns_id_to_pem_map():
    fake_pem = "-----BEGIN PUBLIC KEY-----\nfakekey\n-----END PUBLIC KEY-----"
    respx.get("https://api.github.com/meta/public_keys/copilot_api").mock(
        return_value=httpx.Response(200, json={
            "public_keys": [
                {"key_identifier": "abc123", "key": fake_pem},
                {"key_identifier": "def456", "key": fake_pem},
            ]
        })
    )
    keys = await fetch_github_public_keys()
    assert keys == {"abc123": fake_pem, "def456": fake_pem}
