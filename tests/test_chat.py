"""
Pure-logic unit tests for the AI chat WebSocket helpers.

These tests exercise the context-window / history-building helpers from
backend.routers.ws without a database — fake message objects are sufficient
because the helpers only read `.role`, `.content` and `.message_metadata`.
"""

import unittest
from types import SimpleNamespace

from backend.routers import ws


def _msg(role: str, content: str, message_metadata: dict | None = None):
    """Build a fake ChatMessage-like object."""
    return SimpleNamespace(role=role, content=content, message_metadata=message_metadata or {})


class TestSplitHistory(unittest.TestCase):
    def test_empty_history(self):
        keep, trimmed = ws.split_history([])
        self.assertEqual(keep, [])
        self.assertEqual(trimmed, [])

    def test_history_within_window(self):
        history = [_msg("user", f"m{i}") for i in range(5)]
        keep, trimmed = ws.split_history(history, max_messages=10)
        self.assertEqual(keep, history)
        self.assertEqual(trimmed, [])

    def test_window_keeps_latest_trim_older(self):
        history = [_msg("user", f"m{i}") for i in range(5)]
        keep, trimmed = ws.split_history(history, max_messages=2)
        self.assertEqual([m.content for m in keep], ["m3", "m4"])
        self.assertEqual([m.content for m in trimmed], ["m0", "m1", "m2"])

    def test_boundary_equal_to_window(self):
        history = [_msg("user", f"m{i}") for i in range(3)]
        keep, trimmed = ws.split_history(history, max_messages=3)
        self.assertEqual(len(keep), 3)
        self.assertEqual(trimmed, [])

    def test_boundary_one_over_window(self):
        history = [_msg("user", f"m{i}") for i in range(3)]
        keep, trimmed = ws.split_history(history, max_messages=2)
        self.assertEqual(len(keep), 2)
        self.assertEqual(len(trimmed), 1)


class TestBuildGeminiHistory(unittest.TestCase):
    def test_skips_error_messages_and_excludes_just_sent(self):
        history = [
            _msg("user", "hello"),
            _msg("assistant", "hi there", message_metadata={"is_error": True, "error_type": "generic"}),
            _msg("assistant", "real reply", message_metadata={}),
            _msg("user", "question 2"),  # just-sent message, must be excluded
        ]
        result = ws.build_gemini_history(history, "SYSTEM PROMPT", "", None)
        texts = [m["parts"][0]["text"] for m in result]
        self.assertEqual(texts, ["hello", "real reply"])
        self.assertEqual(result[0]["role"], "user")
        self.assertEqual(result[1]["role"], "model")

    def test_fresh_session_system_injection(self):
        history = [_msg("user", "new question")]
        result = ws.build_gemini_history(history, "SYSTEM PROMPT", "\nJOB CTX", None)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["role"], "user")
        self.assertIn("SYSTEM PROMPT", result[0]["parts"][0]["text"])
        self.assertIn("JOB CTX", result[0]["parts"][0]["text"])
        self.assertEqual(result[1]["role"], "model")

    def test_fresh_session_injects_summary(self):
        history = [_msg("user", "new question")]
        result = ws.build_gemini_history(history, "SYSTEM PROMPT", "\nJOB CTX", "We discussed pricing.")
        self.assertEqual(len(result), 2)
        self.assertIn("PRIOR CONVERSATION SUMMARY", result[0]["parts"][0]["text"])
        self.assertIn("We discussed pricing.", result[0]["parts"][0]["text"])

    def test_summary_prepended_when_history_present(self):
        history = [
            _msg("user", "first"),
            _msg("assistant", "answer"),
            _msg("user", "latest"),  # just-sent message, must be excluded
        ]
        result = ws.build_gemini_history(history, "SYSTEM", "", "OLD SUMMARY")
        texts = [m["parts"][0]["text"] for m in result]
        self.assertNotIn("latest", texts)
        self.assertEqual(
            result[0]["parts"][0]["text"],
            "PRIOR CONVERSATION SUMMARY (do not repeat this; it is background context):\nOLD SUMMARY",
        )
        self.assertEqual(result[1]["role"], "model")
        self.assertEqual(result[1]["parts"][0]["text"], "Understood.")
        self.assertEqual(texts[-1], "answer")

    def test_no_summary_injection_when_history_present_without_summary(self):
        history = [
            _msg("user", "first"),
            _msg("assistant", "answer"),
            _msg("user", "latest"),
        ]
        result = ws.build_gemini_history(history, "SYSTEM", "", None)
        texts = [m["parts"][0]["text"] for m in result]
        self.assertEqual(texts, ["first", "answer"])


if __name__ == "__main__":
    unittest.main()
