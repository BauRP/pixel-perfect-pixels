#!/usr/bin/env bash
# Shell-level Android smoke of ACTUAL installed APK; screenshots before exit.
# Never changes real user data: this runs only on disposable CI emulators.
set -euo pipefail
: "${ANDROID_SERIAL:=emulator-5554}"
PACKAGE=app.lovable.privacygallery
ACTIVITY="$PACKAGE/.MainActivity"
mkdir -p emulator-diagnostics
failedScreenshots=0
wrongForeground=0
echo "Android $(adb shell getprop ro.build.version.release | tr -d '\r'), API $(adb shell getprop ro.build.version.sdk | tr -d '\r')"
adb shell dumpsys webviewupdate | head -25 || true
adb shell wm size
adb shell wm density
adb shell pm path "$PACKAGE" | grep '^package:' >/dev/null
original_rotation="$(adb shell settings get system user_rotation | tr -d '\r')"
original_auto_rotate="$(adb shell settings get system accelerometer_rotation | tr -d '\r')"
original_nav_overlay="$(adb shell cmd overlay list --user 0 2>/dev/null | grep -E '^\[x\] com.android.internal.systemui.navbar.' | head -1 | sed 's/^\[x\] //' || true)"
cleanup() {
  adb shell wm size reset >/dev/null 2>&1 || true
  adb shell wm density reset >/dev/null 2>&1 || true
  # Never leave a modified nav overlay for subsequent emulator tests.
  if [[ -n "$original_nav_overlay" ]]; then
    adb shell cmd overlay enable "$original_nav_overlay" >/dev/null 2>&1 || true
  fi
  if [[ "$original_rotation" =~ ^[0-3]$ ]]; then
    adb shell settings put system user_rotation "$original_rotation" >/dev/null 2>&1 || true
  fi
  if [[ "$original_auto_rotate" =~ ^[01]$ ]]; then
    adb shell settings put system accelerometer_rotation "$original_auto_rotate" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
start_app() {
  # CI instrumentation can kill the app when Play Services' provider dies.
  # Retry one genuine cold launch, rather than falsely classify a one-off
  # provider crash as an app layout failure or silently accept the launcher.
  local attempt focus launched=0
  for attempt in 1 2; do
    if ! adb shell am start -W -n "$ACTIVITY"; then
      echo "ActivityManager launch failed on attempt $attempt for $1"
    fi
    sleep 4
    focus="$(adb shell dumpsys window | grep -m1 'mCurrentFocus=' || true)"
    if [[ -z "$focus" ]]; then
      focus="$(adb shell dumpsys activity activities | grep -m1 -E 'mResumedActivity|topResumedActivity' || true)"
    fi
    if adb shell pidof "$PACKAGE" >/dev/null 2>&1 &&
       [[ "$focus" == *"$PACKAGE"* ]]; then
      launched=1
      break
    fi
    echo "Gallery not foreground after launch $attempt for $1: $focus"
    if (( attempt == 1 )); then
      adb shell input keyevent KEYCODE_HOME >/dev/null 2>&1 || true
      sleep 2
    fi
  done
  echo "Foreground for $1: $focus" | tee -a emulator-diagnostics/foreground.txt
  if (( launched == 0 )); then
    echo "FAIL: the gallery process/window did not survive either launch for $1"
    wrongForeground=$((wrongForeground + 1))
    adb shell dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity|ResumedActivity' | head -8 || true
    return 1
  fi
  adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' | head -4 || true
  adb shell dumpsys activity top > "emulator-diagnostics/activity-$1.txt" 2>&1 || true
  adb shell dumpsys window > "emulator-diagnostics/window-$1.txt" 2>&1 || true
  local imageOk=0
  for attempt in 1 2; do
    adb shell screencap -p "/sdcard/nova-$1.png" >/dev/null 2>&1 || true
    adb pull "/sdcard/nova-$1.png" "emulator-diagnostics/$1.png" >/dev/null 2>&1 || true
    if java scripts/ValidateScreenshot.java "emulator-diagnostics/$1.png"; then
      imageOk=1
      break
    fi
    if (( attempt == 1 )); then
      echo "Unpainted screenshot for $1, confirming after a further frame delay"
      sleep 3
    fi
  done
  if (( imageOk == 0 )); then
    echo "FAIL: actual $1 screenshot has no readable gallery pixels"
    failedScreenshots=$((failedScreenshots + 1))
  fi
}
start_app portrait
# Capture OS insets state for physical rotation, gestures, cutouts and
# keyboard modes, independent of Java instrumentation pass/fail.
adb shell dumpsys window > emulator-diagnostics/window-portrait.txt || true
adb shell wm size 360x780
start_app compact
adb shell wm size 320x480
start_app small_window
adb shell wm size 1024x600
start_app wide_tablet
adb shell wm size 780x360
start_app wide
adb shell wm size reset
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
sleep 2
start_app orientation_90
adb shell settings put system user_rotation 0
sleep 2
start_app orientation_0
cleanup
API="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
if (( API >= 29 )); then
  for mode in threebutton gestural; do
    overlay="com.android.internal.systemui.navbar.$mode"
    if adb shell cmd overlay enable "$overlay" >/dev/null 2>&1; then
      echo "Requested navigation overlay: $mode"
      # A successful command does not guarantee Android activated the
      # requested overlay. Capture actual state for audit.
      adb shell cmd overlay list --user 0 > "emulator-diagnostics/overlay-$mode.txt" 2>&1 || true
      if ! grep -Fq "[x] $overlay" "emulator-diagnostics/overlay-$mode.txt"; then
        echo "WARN: overlay $mode accepted but not confirmed active"
      fi
      start_app "$mode"
      adb shell dumpsys window > "emulator-diagnostics/window-$mode.txt" || true
    else
      echo "SKIP $mode overlay: this Android emulator does not support it"
    fi
  done
fi
echo "APK snapshots: blank=$failedScreenshots wrong_foreground=$wrongForeground"
if (( failedScreenshots > 0 || wrongForeground > 0 )); then
  echo "FAIL: $failedScreenshots blank screenshot(s), $wrongForeground non-gallery foreground window(s)"
  exit 1
fi
echo "APK launch, compact/wide resize and available navigation modes completed."
