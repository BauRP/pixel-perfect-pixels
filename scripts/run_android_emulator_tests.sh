#!/usr/bin/env bash
# A single shell is essential: reactivecircus executes separate YAML script
# lines in separate shells and a preceding 'cd android' does not persist.
set -euo pipefail
echo "Connected emulator:"
adb wait-for-device
adb devices -l
adb shell getprop ro.build.version.sdk
chmod +x android/gradlew
(
  cd android
  ./gradlew :app:connectedDebugAndroidTest --stacktrace --no-daemon
)
# The instrumented test runner may uninstall the target package when it
# finishes. Reinstall the real app before exercising activity and navigation.
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell pm path app.lovable.privacygallery | grep '^package:' >/dev/null
bash scripts/emulator_navigation_smoke.sh
