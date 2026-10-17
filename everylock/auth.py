"""Synthetic account generation and local-only authentication helpers."""

from __future__ import annotations

import hashlib
import hmac
import random
import secrets
import string

from models import AccountStatus, VirtualAccount


def hash_password(password: str, salt: bytes | None = None) -> str:
    """Hash a synthetic password with PBKDF2; output includes its random salt."""
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return f"pbkdf2_sha256$120000${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    algorithm, iterations, salt_hex, expected_hex = encoded.split("$", 3)
    if algorithm != "pbkdf2_sha256":
        return False
    actual = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations)
    )
    return hmac.compare_digest(actual.hex(), expected_hex)


def generate_accounts(count: int, seed: int) -> list[VirtualAccount]:
    """Create deterministic, clearly fictional IDs and non-exported passwords.

    The ``SIM`` marker ensures IDs cannot be confused with real student numbers.
    """
    rng = random.Random(seed)
    accounts: list[VirtualAccount] = []
    for index in range(count):
        year = rng.choice((2024, 2025, 2026))
        user_id = f"{year}SIM-{index + 1:05d}"
        password = "".join(rng.choices(string.ascii_letters + string.digits, k=18))
        # Bulk simulation accounts are never used for interactive login. A fast,
        # one-way synthetic marker keeps 10,000-account resets responsive while
        # still avoiding storage of generated plaintext values.
        digest = hashlib.sha256(f"everylock:{seed}:{index}:{password}".encode()).hexdigest()
        accounts.append(VirtualAccount(user_id=user_id, password_hash=f"synthetic_sha256${digest}"))
    return accounts


def authenticate(account: VirtualAccount, password: str, threshold: int = 10) -> bool:
    """Authenticate one local virtual account under the baseline policy."""
    if account.account_status == AccountStatus.LOCKED:
        return False
    if verify_password(password, account.password_hash):
        account.failed_attempts = 0
        return True
    account.failed_attempts += 1
    if account.failed_attempts >= threshold:
        account.account_status = AccountStatus.LOCKED
    return False


def admin_unlock(account: VirtualAccount) -> None:
    account.failed_attempts = 0
    account.account_status = AccountStatus.ACTIVE
    account.lock_timestamp = None
    account.delay_seconds = 0
    account.verification_required = False
