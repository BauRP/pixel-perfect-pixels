#!/usr/bin/env bash
# Run independent Java instrumentation and shell smoke, even if one fails.
# This distinguishes a slow WebView JS callback from a native app crash.
set -euo pipefail
mkdir -p emulator-diagnostics
status_tests=0
status_shell=0
on_exit() {
  status=$?
  # These are disposable GitHub CI emulators, never personal phones.
  adb logcat -d -v time > emulator-diagnostics/logcat.txt 2>&1 || true
  adb shell dumpsys webviewupdate > emulator-diagnostics/webview-provider.txt 2>&1 || true
  adb shell dumpsys window > emulator-diagnostics/window.txt 2>&1 || true
  echo "Java tests: $status_tests | native shell smoke: $status_shell | script: $status" > emulator-diagnostics/result.txt
}
trap on_exit EXIT
adb wait-for-device
adb devices -l
adb shell getprop ro.build.version.sdk
chmod +x android/gradlew
# The Java test runner can remove the app on completion. Always try the
# independent install/launch/resize/navigation test afterwards.
(
  cd android
  ./gradlew :app:connectedDebugAndroidTest --stacktrace --no-daemon
) || status_tests=$?
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell pm path app.lovable.privacygallery | grep '^package:' >/dev/null
bash scripts/emulator_navigation_smoke.sh || status_shell=$?
printf 'Instrumentation result=%s | UI launch/resize result=%s\n' "$status_tests" "$status_shell"
if (( status_tests != 0 || status_shell != 0 )); then exit 1; fi
