from auth import admin_unlock, authenticate, generate_accounts, hash_password, verify_password
from models import AccountStatus, VirtualAccount


def test_password_hash_and_verification() -> None:
    encoded = hash_password("synthetic-secret", b"0123456789abcdef")
    assert verify_password("synthetic-secret", encoded)
    assert not verify_password("wrong", encoded)
    assert "synthetic-secret" not in encoded


def test_accounts_are_reproducible_and_clearly_synthetic() -> None:
    first = generate_accounts(100, seed=7)
    second = generate_accounts(100, seed=7)
    assert [a.user_id for a in first] == [a.user_id for a in second]
    assert [a.password_hash for a in first] == [a.password_hash for a in second]
    assert all("SIM-" in account.user_id for account in first)


def test_lock_and_admin_unlock() -> None:
    account = VirtualAccount("2026SIM-00001", hash_password("correct"))
    for _ in range(3):
        assert not authenticate(account, "wrong", threshold=3)
    assert account.account_status == AccountStatus.LOCKED
    admin_unlock(account)
    assert account.account_status == AccountStatus.ACTIVE
    assert account.failed_attempts == 0
