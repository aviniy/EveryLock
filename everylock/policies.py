"""Policy implementations used by the isolated simulation engine."""

from __future__ import annotations

from datetime import datetime, timezone

from models import AccountStatus, PolicyMetrics, SimulationEvent, VirtualAccount


def apply_policy_a(
    account: VirtualAccount, threshold: int, metrics: PolicyMetrics
) -> list[SimulationEvent]:
    """Hard lockout after N failures; administrator recovery is required."""
    events = [SimulationEvent.create("ACCOUNT", account.user_id, "A", "FAILED_ATTEMPTS_UPDATED")]
    if account.account_status == AccountStatus.LOCKED:
        metrics.denied_events += 1
        events[0].result = "DENIED_ALREADY_LOCKED"
        return events

    account.failed_attempts += 1
    if account.failed_attempts >= threshold:
        account.account_status = AccountStatus.LOCKED
        account.lock_timestamp = datetime.now(timezone.utc).isoformat()
        metrics.locked_accounts += 1
        metrics.denied_events += 1
        events.append(SimulationEvent.create("SECURITY", account.user_id, "A", "ACCOUNT_LOCKED"))
    return events


def apply_policy_b(
    account: VirtualAccount, threshold: int, metrics: PolicyMetrics
) -> list[SimulationEvent]:
    """Adaptive response: progressive delay plus verification, without hard lockout.

    This simplified model intentionally exposes trade-offs: it preserves account
    availability but can deny suspicious attempts and add user friction.
    """
    account.failed_attempts += 1
    events = [SimulationEvent.create("ACCOUNT", account.user_id, "B", "FAILED_ATTEMPTS_UPDATED")]

    delay_start = max(2, threshold // 3)
    if account.failed_attempts >= delay_start:
        stage = account.failed_attempts - delay_start + 1
        account.delay_seconds = min(32, 2 ** min(stage, 5))
        metrics.delayed_events += 1
        events.append(
            SimulationEvent.create("DEFENSE", account.user_id, "B", f"PROGRESSIVE_DELAY_{account.delay_seconds}S")
        )

    if account.failed_attempts >= threshold:
        account.verification_required = True
        metrics.verification_events += 1
        metrics.denied_events += 1
        events.append(SimulationEvent.create("DEFENSE", account.user_id, "B", "ADDITIONAL_VERIFICATION_REQUIRED"))
    return events
