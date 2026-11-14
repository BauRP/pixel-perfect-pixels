import unittest

from check_android_instrumentation import instrumentation_passed


SUCCESS = """INSTRUMENTATION_STATUS_CODE: 1
INSTRUMENTATION_STATUS: test=galleryOpens
INSTRUMENTATION_STATUS_CODE: 0
INSTRUMENTATION_CODE: -1
"""
BROKEN_API24 = """INSTRUMENTATION_STATUS: test=settingsThemeSwitchSurvivesWebViewReload
INSTRUMENTATION_STATUS: stack=java.lang.AssertionError: Could not open theme selector
INSTRUMENTATION_STATUS_CODE: -2
Tests run: 36,  Failures: 1
INSTRUMENTATION_CODE: -1
"""


class InstrumentationVerdictTests(unittest.TestCase):
    def test_real_success(self):
        self.assertTrue(instrumentation_passed(SUCCESS))

    def test_false_positive_native_exit_on_failed_theme_switch(self):
        self.assertFalse(instrumentation_passed(BROKEN_API24))

    def test_zero_tests_cannot_pass(self):
        self.assertFalse(instrumentation_passed("INSTRUMENTATION_CODE: -1\n"))

    def test_missing_completion_cannot_pass(self):
        self.assertFalse(instrumentation_passed(
            "INSTRUMENTATION_STATUS_CODE: 0\n"))

    def test_explicit_instrumentation_failure_is_rejected(self):
        self.assertFalse(instrumentation_passed(
            SUCCESS + "INSTRUMENTATION_FAILED: runner died\n"))

    def test_failure_summary_is_rejected_even_if_status_marker_missing(self):
        self.assertFalse(instrumentation_passed(
            SUCCESS + "Tests run: 36,  Failures: 1\n"))


if __name__ == "__main__":
    unittest.main()
