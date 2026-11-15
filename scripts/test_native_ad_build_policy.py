"""Static guard for release-only advertising settings.

The Android instrumented policy test covers the installed *debug* variant.
This separate check prevents mistakes in build.gradle that could silently
place debug consent bypasses or test IDs into the release variant.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "android/app/build.gradle"
PLUGIN = ROOT / "android/app/src/main/java/app/lovable/privacygallery/NativeAdsPlugin.java"
POLICY = ROOT / "android/app/src/main/java/app/lovable/privacygallery/NativeAdUnitPolicy.java"


def branch(body: str, name: str) -> str:
    # Gradle buildTypes contain nested braces in interpolated values.
    # Use a brace-aware parser rather than a one-level regular expression.
    match = re.search(r"(?m)^\s*" + re.escape(name) + r"\s*\{", body)
    if match is None:
        raise AssertionError(f"Missing Android {name} build type")
    start = match.end()
    depth = 1
    for offset in range(start, len(body)):
        if body[offset] == "{":
            depth += 1
        elif body[offset] == "}":
            depth -= 1
            if depth == 0:
                return body[start:offset]
    raise AssertionError(f"Unclosed Android {name} build type")

class NativeAdBuildPolicyTest(unittest.TestCase):
    def test_debug_and_release_build_type_contract(self):
        content = BUILD.read_text(encoding="utf-8")
        debug = branch(content, "debug")
        release = branch(content, "release")
        self.assertRegex(debug, r'buildConfigField\s+"boolean",\s*"USE_TEST_ADS",\s*"true"')
        self.assertRegex(release, r'buildConfigField\s+"boolean",\s*"USE_TEST_ADS",\s*"false"')
        self.assertRegex(release, r'buildConfigField\s+"long",\s*"DEBUG_CONSENT_FALLBACK_MS",\s*"0L"')
        self.assertRegex(release, r'buildConfigField\s+"String",\s*"UMP_DEBUG_GEOGRAPHY",\s*"\\\"\\\""')
        self.assertRegex(release, r'buildConfigField\s+"String",\s*"UMP_TEST_DEVICE_ID",\s*"\\\"\\\""')
        self.assertRegex(release, r'manifestPlaceholders\s*=\s*\[nativeAdDebuggerEnabled:\s*"false"\]')
        self.assertIn('debuggable false', release)

    def test_plugin_uses_one_build_config_driven_policy(self):
        plugin = PLUGIN.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")
        self.assertIn('NativeAdUnitPolicy.select(BuildConfig.USE_TEST_ADS, prodId)', plugin)
        self.assertIn('BuildConfig.USE_TEST_ADS && debugConsentFallback', plugin)
        self.assertIn('GOOGLE_TEST_NATIVE_UNIT', policy)
        self.assertIn('return useTestAds ? GOOGLE_TEST_NATIVE_UNIT : productionUnit;', policy)
        self.assertNotIn('BuildConfig.DEBUG ?', plugin)


if __name__ == "__main__":
    unittest.main()
