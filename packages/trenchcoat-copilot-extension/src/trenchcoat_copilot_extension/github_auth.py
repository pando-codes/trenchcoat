from __future__ import annotations

import base64

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

GITHUB_KEYS_URL = "https://api.github.com/meta/public_keys/copilot_api"


async def fetch_github_public_keys() -> dict[str, str]:
    """Return a mapping of key_identifier → PEM public key string."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(GITHUB_KEYS_URL)
        resp.raise_for_status()
    data = resp.json()
    return {k["key_identifier"]: k["key"] for k in data["public_keys"]}


def verify_github_signature(
    payload: bytes,
    key_id: str,
    signature: str,
    keys: dict[str, str],
) -> bool:
    """Return True if the ECDSA P-256 signature over payload is valid for the given key_id."""
    if key_id not in keys:
        return False
    try:
        pem = keys[key_id].encode()
        public_key = serialization.load_pem_public_key(pem)
        sig_bytes = base64.b64decode(signature)
        public_key.verify(sig_bytes, payload, ec.ECDSA(hashes.SHA256()))
        return True
    except Exception:
        return False
