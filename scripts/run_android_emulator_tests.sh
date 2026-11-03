#!/usr/bin/env bash
# Run independent Java instrumentation and shell smoke, even if one fails.
# This distinguishes a slow WebView JS callback from a native app crash.
set -euo pipefail
mkdir -p emulator-diagnostics
APP_APK="emulator-apks/app-debug.apk"
TEST_APK="emulator-apks/app-debug-androidTest.apk"
test -s "$APP_APK" || { echo "Missing shared application APK"; exit 1; }
test -s "$TEST_APK" || { echo "Missing shared instrumentation APK"; exit 1; }
sha256sum "$APP_APK" "$TEST_APK" > emulator-diagnostics/apk-sha256.txt
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
  # Preserve the boot errors which are otherwise buried in large logcat.
  grep -E 'NovaGalleryBoot|AndroidCompatTest|Capacitor/Console.*(Error|Uncaught)|E/chromium|FATAL EXCEPTION|Input dispatching timed out' emulator-diagnostics/logcat.txt     > emulator-diagnostics/boot-errors.txt 2>/dev/null || true
  echo "Java tests: $status_tests | native shell smoke: $status_shell | script: $status" > emulator-diagnostics/result.txt
  python3 scripts/summarize_android_diagnostics.py emulator-diagnostics || true
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
du -h "$APP_APK" || true
echo "Device data partition:"
adb shell df -h /data || true
adb shell pm trim-caches 1073741824 >/dev/null 2>&1 || true
if ! adb install -r "$APP_APK"; then
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
# Use the byte-identical instrumentation APK built once upstream. Avoid six
# simultaneous Gradle/Maven dependency downloads (429 Too Many Requests).
# Android's instrumentation exit code alone is sometimes 0 on test failures;
# require the explicit runner success marker as well.
if adb install -r "$TEST_APK"; then
  adb shell am instrument -w -r     app.lovable.privacygallery.test/androidx.test.runner.AndroidJUnitRunner     > emulator-diagnostics/instrumentation.txt 2>&1 || status_tests=$?
  cat emulator-diagnostics/instrumentation.txt
  if ! grep -Fxq 'INSTRUMENTATION_CODE: -1' emulator-diagnostics/instrumentation.txt; then
    echo "FAIL: native instrumentation lacks successful completion marker"
    status_tests=1
  fi
else
  echo "FAIL: shared instrumentation APK could not be installed"
  status_tests=1
fi
# Native tests may relaunch or clear state; perform independent screenshot
# smoke against the EXACT same app binary, with no rebuilding.
adb install -r "$APP_APK"
adb shell pm path app.lovable.privacygallery | grep '^package:' >/dev/null
grant_smoke_media_permissions
bash scripts/emulator_navigation_smoke.sh || status_shell=$?
printf 'Instrumentation result=%s | UI launch/resize result=%s\n' "$status_tests" "$status_shell"
if (( status_tests != 0 || status_shell != 0 )); then exit 1; fi
