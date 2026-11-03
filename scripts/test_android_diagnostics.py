import unittest
from summarize_android_diagnostics import classify

APP = (
    "11-03 E/AndroidRuntime( 9): FATAL EXCEPTION: main\n"
    "11-03 E/AndroidRuntime( 9): Process: app.lovable.privacygallery, PID: 9\n"
)
LAUNCHER = (
    "11-03 E/AndroidRuntime( 9): FATAL EXCEPTION: main\n"
    "11-03 E/AndroidRuntime( 9): Process: com.google.android.apps.nexuslauncher, PID: 9\n"
)


class DiagnosticsTests(unittest.TestCase):
    def test_launcher_crashes_are_not_gallery_crashes(self):
        summary = classify(LAUNCHER + "[NovaBoot] react-root-committed", "script: 1", "")
        self.assertEqual(summary["app_crashes"], 0)
        self.assertEqual(summary["launcher_crashes"], 1)
        self.assertEqual(summary["diagnosis"], "ROUTE_NOT_VISIBLE_AFTER_REACT_COMMIT")

    def test_gallery_crash_is_reported_separately(self):
        summary = classify(APP + "[NovaBoot] route-visible", "script: 1", "")
        self.assertEqual(summary["app_crashes"], 1)
        self.assertEqual(summary["diagnosis"], "GALLERY_PROCESS_CRASH")

    def test_router_failure_precedes_generic_route_timeout(self):
        summary = classify(
            "[NovaBoot] react-root-committed\n[NovaBoot] router-load-rejected",
            "script: 1", "")
        self.assertEqual(summary["diagnosis"], "ROUTER_LOAD_REJECTED")

    def test_success_requires_passed_tests_and_real_first_frame(self):
        log = "\n".join([
            "[NovaBoot] entry-loaded", "[NovaBoot] react-root-committed",
            "[NovaBoot] route-visible", "React gallery UI mounted",
            "First gallery compositor frame confirmed",
        ])
        result = classify(log, "Java tests: 0 | native shell smoke: 0 | script: 0", "")
        self.assertEqual(result["diagnosis"], "PASS_WITH_CONFIRMED_PAINT")
        self.assertEqual(classify(log, "script: 1", "")["diagnosis"], "NEEDS_MANUAL_REVIEW")

    def test_untrusted_system_insets_are_a_failure(self):
        result = classify(
            "[NovaBoot] route-visible\n[NovaLayout] NATIVE_INSETS_PENDING",
            "script: 1", "")
        self.assertEqual(result["diagnosis"], "UNVALIDATED_SYSTEM_BAR_OR_NAV_GEOMETRY")
        self.assertIn("NATIVE_INSETS_PENDING", result["layout_issue_types"])


if __name__ == "__main__":
    unittest.main()
