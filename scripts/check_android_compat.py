#!/usr/bin/env python3
"""Static Android 7–17 configuration guard; does not claim runtime validation."""
from pathlib import Path
import re
ROOT = Path(__file__).resolve().parent.parent
def read(p):
    return (ROOT / p).read_text(encoding="utf-8")
def check(label, pattern, source):
    if not re.search(pattern, read(source), re.M):
        raise SystemExit("SDK compatibility regression: " + label + " (" + source + ")")
    print("OK:", label)

for label,pattern in (
    ("Android 7 minSdk 24", r"^\s*minSdkVersion\s*=\s*24\b"),
    ("Stable compileSdk 36", r"^\s*compileSdkVersion\s*=\s*36\b"),
    ("Stable targetSdk 36", r"^\s*targetSdkVersion\s*=\s*36\b"),
    ("Kotlin 2.2.20", r"kotlin_version\s*=\s*'2\.2\.20'"),
):
    check(label,pattern,"android/variables.gradle")
check("Android Gradle plugin 8.13",r"com\.android\.tools\.build:gradle:8\.13\.0","android/build.gradle")
check("Gradle wrapper 8.13",r"gradle-8\.13-bin\.zip","android/gradle/wrapper/gradle-wrapper.properties")
check("CI Android SDK 36",r"platforms;android-36",".github/workflows/build.yml")
check("CI runs SDK guard",r"python3 scripts/check_android_compat\.py",".github/workflows/build.yml")
check("Native insets registered",r"registerPlugin\(SystemInsetsPlugin\.class\)","android/app/src/main/java/app/lovable/privacygallery/MainActivity.java")
# Capacitor 4+ constructs the bridge inside super.onCreate.
# All local plugins must be registered before that point.
activity = read("android/app/src/main/java/app/lovable/privacygallery/MainActivity.java")
creation = re.search(r"void onCreate\(Bundle savedInstanceState\)\s*\{(.*?)applyTransparentStatusBar\(", activity, re.S)
if not creation:
    raise SystemExit("Cannot inspect MainActivity.onCreate")
body = creation.group(1)
super_at = body.find("super.onCreate(savedInstanceState)")
if super_at < 0:
    raise SystemExit("Capacitor BridgeActivity.onCreate not called")
for name in ("SecureVaultPlugin", "NativeAdsPlugin", "SystemInsetsPlugin"):
    registration = body.find("registerPlugin(" + name + ".class)")
    if registration < 0 or registration > super_at:
        raise SystemExit(name + " must be registered BEFORE super.onCreate")
print("OK: all three local Capacitor plugins register before the bridge starts")
for permission in ("READ_MEDIA_IMAGES","READ_MEDIA_VIDEO","READ_MEDIA_VISUAL_USER_SELECTED","READ_EXTERNAL_STORAGE"):
    check(permission,r"android\.permission\."+permission+r"\b","android/app/src/main/AndroidManifest.xml")
print("Minimum API 24, build/target API 36. Android 17 and devices unverified.")
