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
  adb shell dumpsys power > emulator-diagnostics/power.txt 2>&1 || true
  adb shell dumpsys activity activities > emulator-diagnostics/activities.txt 2>&1 || true
  adb shell df -h /data > emulator-diagnostics/disk.txt 2>&1 || true
  adb shell dumpsys package app.lovable.privacygallery > emulator-diagnostics/package.txt 2>&1 || true
  echo "Java tests: $status_tests | native shell smoke: $status_shell | script: $status" > emulator-diagnostics/result.txt
}
trap on_exit EXIT
adb wait-for-device
adb devices -l
adb shell getprop ro.build.version.sdk
# Do not let the emulator sleep and suspend WebView JS callbacks mid-test.
adb shell svc power stayon true || true
adb shell settings put system screen_off_timeout 1800000 || true
adb shell input keyevent KEYCODE_WAKEUP || true
adb shell wm dismiss-keyguard || true
adb shell input keyevent KEYCODE_HOME || true
# Validate installer/storage state separately, before the Android Gradle
# instrumentation runner attempts a split-APK install. Android 7 emulators
# occasionally fail while installing (0 tests), not in app code.
echo "Pre-test APK size:"
du -h android/app/build/outputs/apk/debug/app-debug.apk || true
echo "Device data partition:"
adb shell df -h /data || true
adb shell pm trim-caches 1073741824 >/dev/null 2>&1 || true
if ! adb install -r android/app/build/outputs/apk/debug/app-debug.apk; then
  echo "Pre-test APK installation failed; storage and PackageManager diagnostics:"
  adb shell df -h /data || true
  adb shell dumpsys package | head -35 || true
  exit 1
fi
# Layout tests must not be blocked by the first-run gallery permission
# sheet. Permissions are pre-granted ONLY in disposable CI emulators; the
# production app retains its ordinary user-controlled consent flow.
grant_smoke_media_permissions() {
  local sdk
  sdk="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
  if (( sdk >= 33 )); then
    adb shell pm grant app.lovable.privacygallery android.permission.READ_MEDIA_IMAGES
    adb shell pm grant app.lovable.privacygallery android.permission.READ_MEDIA_VIDEO
  else
    adb shell pm grant app.lovable.privacygallery android.permission.READ_EXTERNAL_STORAGE
  fi
  echo "CI layout-test media grants applied on API ${sdk}"
}
grant_smoke_media_permissions
chmod +x android/gradlew
# The Java test runner can remove the app on completion. Always try the
# independent install/launch/resize/navigation test afterwards.
(
  cd android
  ./gradlew :app:connectedDebugAndroidTest --stacktrace --no-daemon
) || status_tests=$?
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell pm path app.lovable.privacygallery | grep '^package:' >/dev/null
grant_smoke_media_permissions
bash scripts/emulator_navigation_smoke.sh || status_shell=$?
printf 'Instrumentation result=%s | UI launch/resize result=%s\n' "$status_tests" "$status_shell"
if (( status_tests != 0 || status_shell != 0 )); then exit 1; fi
