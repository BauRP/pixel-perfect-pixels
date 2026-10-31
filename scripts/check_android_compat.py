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
    ("Android 17 compileSdk 36", r"^\s*compileSdkVersion\s*=\s*36\b"),
    ("Android 17 targetSdk 36", r"^\s*targetSdkVersion\s*=\s*36\b"),
    ("Kotlin 2.4.20", r"kotlin_version\s*=\s*'2\.2\.20'"),
):
    check(label,pattern,"android/variables.gradle")
check("Android Gradle plugin 9.2",r"com\.android\.tools\.build:gradle:8\.13\.0","android/build.gradle")
check("Gradle wrapper 9.4.1",r"gradle-8\.13-bin\.zip","android/gradle/wrapper/gradle-wrapper.properties")
check("CI Android SDK 36",r"platforms;android-36",".github/workflows/build.yml")
check("CI runs SDK guard",r"python3 scripts/check_android_compat\.py",".github/workflows/build.yml")
check("Native insets registered",r"registerPlugin\(SystemInsetsPlugin\.class\)","android/app/src/main/java/app/lovable/privacygallery/MainActivity.java")
for permission in ("READ_MEDIA_IMAGES","READ_MEDIA_VIDEO","READ_MEDIA_VISUAL_USER_SELECTED","READ_EXTERNAL_STORAGE"):
    check(permission,r"android\.permission\."+permission+r"\b","android/app/src/main/AndroidManifest.xml")
print("Configured range API 24–36. Emulator/device verification remains pending.")
