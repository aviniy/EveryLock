import argparse
import re
import unittest

from everylock_attack_sim import (
    STUDENT_ID_PATTERN,
    generate_password,
    generate_student_ids,
    validate_target,
)


class EveryLockSimulatorTests(unittest.TestCase):
    def test_target_accepts_only_local_lab(self) -> None:
        self.assertEqual(validate_target("http://127.0.0.1:4173"), "http://127.0.0.1:4173")
        for unsafe in (
            "https://127.0.0.1:4173",
            "http://example.com:4173",
            "http://127.0.0.1:4173/api/login",
        ):
            with self.assertRaises(argparse.ArgumentTypeError):
                validate_target(unsafe)

    def test_student_ids_are_unique_reproducible_and_match_format(self) -> None:
        first = generate_student_ids(1000, 2026)
        second = generate_student_ids(1000, 2026)
        self.assertEqual(first, second)
        self.assertEqual(len(first), len(set(first)))
        self.assertTrue(all(STUDENT_ID_PATTERN.fullmatch(item) for item in first))

    def test_password_is_eight_alphanumeric_characters(self) -> None:
        import random

        rng = random.Random(42)
        for _ in range(100):
            self.assertRegex(generate_password(rng), re.compile(r"^[A-Za-z0-9]{8}$"))


if __name__ == "__main__":
    unittest.main()
