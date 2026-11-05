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
    def test_black_system_settings_screen_is_reported_as_emulator_failure(self):
        outcome = classify("[NovaBoot] react-root-committed", "script: 1", "", "unpainted")
        self.assertEqual(outcome["diagnosis"], "SYSTEM_COMPOSITOR_UNRELIABLE")
        self.assertEqual(outcome["system_baseline"], "unpainted")

    def test_valid_system_screen_does_not_hide_gallery_failures(self):
        outcome = classify("[NovaBoot] state-waiting-for-layout", "script: 1",
                           "", "painted")
        self.assertEqual(outcome["diagnosis"], "ROUTE_MOUNTED_BUT_NATIVE_LAYOUT_UNVERIFIED")
        self.assertEqual(outcome["system_baseline"], "painted")

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

    def test_route_only_readiness_is_not_a_passing_native_layout(self):
        summary = classify(
            "[NovaBoot] entry-loaded\n[NovaBoot] react-root-committed\n"
            "[NovaBoot] state-waiting-for-layout\n[NovaBoot] router-load-resolved",
            "Java tests: 1 | native shell smoke: 1 | script: 1", "")
        self.assertEqual(summary["diagnosis"], "ROUTE_MOUNTED_BUT_NATIVE_LAYOUT_UNVERIFIED")
        self.assertEqual(summary["boot_phases"]["route_without_safe_layout"], 1)

    def test_route_without_persistent_shell_is_separate(self):
        summary = classify("[NovaBoot] state-waiting-for-shell", "script: 1", "")
        self.assertEqual(summary["diagnosis"], "ROUTE_WITHOUT_PERSISTENT_ANDROID_SHELL")

    def test_untrusted_system_insets_are_a_failure(self):
        result = classify(
            "[NovaBoot] route-visible\n[NovaLayout] NATIVE_INSETS_PENDING",
            "script: 1", "")
        self.assertEqual(result["diagnosis"], "UNVALIDATED_SYSTEM_BAR_OR_NAV_GEOMETRY")
        self.assertIn("NATIVE_INSETS_PENDING", result["layout_issue_types"])
    
    def test_post_resize_system_control_detects_emulator_compositor_fault(self):
        summary = classify("[NovaBoot] state-waiting-for-layout",
                           "Java tests: 1 | native shell smoke: 1 | script: 1", "",
                           "painted", "unpainted")
        self.assertEqual(summary["diagnosis"], "SYSTEM_COMPOSITOR_UNRELIABLE_AFTER_RESIZE")
        self.assertEqual(summary["system_after_resize"], "unpainted")
        self.assertEqual(classify("[NovaBoot] state-waiting-for-layout", "script: 1",
                                  "", "painted", "painted")["diagnosis"],
                         "ROUTE_MOUNTED_BUT_NATIVE_LAYOUT_UNVERIFIED")
    
    def test_post_resize_system_control_detects_emulator_compositor_fault(self):
        summary = classify("[NovaBoot] state-waiting-for-layout",
                           "Java tests: 1 | native shell smoke: 1 | script: 1", "",
                           "painted", "unpainted")
        self.assertEqual(summary["diagnosis"], "SYSTEM_COMPOSITOR_UNRELIABLE_AFTER_RESIZE")
        self.assertEqual(summary["system_after_resize"], "unpainted")
        self.assertEqual(classify("[NovaBoot] state-waiting-for-layout", "script: 1",
                                  "", "painted", "painted")["diagnosis"],
                         "ROUTE_MOUNTED_BUT_NATIVE_LAYOUT_UNVERIFIED")


if __name__ == "__main__":
    unittest.main()
