import base64
import os
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes, serialization


@pytest.fixture(autouse=True)
def skip_github_signature_verification(monkeypatch):
    """Disable GitHub ECDSA verification in all tests."""
    monkeypatch.setenv("SKIP_GITHUB_SIGNATURE_VERIFICATION", "true")


@pytest.fixture()
def test_key_pair():
    """Returns (private_key, pem_public_key_str) using P-256 for signature tests."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private_key, public_pem


def sign_payload(private_key, payload: bytes) -> str:
    sig = private_key.sign(payload, ec.ECDSA(hashes.SHA256()))
    return base64.b64encode(sig).decode()
