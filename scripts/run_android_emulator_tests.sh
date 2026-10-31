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
bash scripts/emulator_navigation_smoke.sh
