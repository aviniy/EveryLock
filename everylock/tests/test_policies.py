from auth import generate_accounts
from models import AccountStatus, PolicyMetrics
from policies import apply_policy_a, apply_policy_b


def test_policy_a_hard_locks_at_threshold() -> None:
    account = generate_accounts(1, seed=1)[0]
    metrics = PolicyMetrics()
    for _ in range(10):
        apply_policy_a(account, 10, metrics)
    assert account.account_status == AccountStatus.LOCKED
    assert metrics.locked_accounts == 1
    assert metrics.denied_events == 1


def test_policy_b_uses_delay_and_verification_without_hard_lock() -> None:
    account = generate_accounts(1, seed=1)[0]
    metrics = PolicyMetrics()
    events = []
    for _ in range(10):
        events.extend(apply_policy_b(account, 10, metrics))
    assert account.account_status == AccountStatus.ACTIVE
    assert account.delay_seconds > 0
    assert account.verification_required
    assert metrics.verification_events == 1
    assert any(event.result == "ADDITIONAL_VERIFICATION_REQUIRED" for event in events)
