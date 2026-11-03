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
original_font_scale="$(adb shell settings get system font_scale | tr -d '\r')"
original_wm_density="$(adb shell wm density | tail -1 | tr -d '\r')"
original_wm_size="$(adb shell wm size | tail -1 | tr -d '\r')"
echo "Original emulator display: $original_wm_size; $original_wm_density" | tee emulator-diagnostics/display-baseline.txt
original_nav_overlay="$(adb shell cmd overlay list --user 0 2>/dev/null | grep -E '^\[x\] com.android.internal.systemui.navbar.' | head -1 | sed 's/^\[x\] //' || true)"
cleanup() {
  adb shell wm size reset >/dev/null 2>&1 || true
  adb shell wm density reset >/dev/null 2>&1 || true
  if [[ "$original_font_scale" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    adb shell settings put system font_scale "$original_font_scale" >/dev/null 2>&1 || true
  fi
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
start_app portrait || true
# Capture OS insets state for physical rotation, gestures, cutouts and
# keyboard modes, independent of Java instrumentation pass/fail.
adb shell dumpsys window > emulator-diagnostics/window-portrait.txt || true

# IMPORTANT: 'wm size 320x480' sets PHYSICAL pixels, not Android dp.
# The old smoke kept Pixel 2's ~420dpi, producing only 122-140 CSS pixels,
# a width below three 48dp touch targets. It also repeatedly crashed the
# emulator launcher and exhausted Chromium's graphics buffer. For actual
# compact/wide window tests, change BOTH size and density so the WebView
# receives the intended viewport in logical dp. The user's display is never
# modified: this script only runs on disposable GitHub emulators and the
# cleanup trap restores both settings.
set_logical_viewport() {
  local width="$1" height="$2" label="$3"
  adb shell wm density 160
  adb shell wm size "${width}x${height}"
  sleep 2
  echo "$label: requested ${width}x${height}dp at 160dpi" | tee -a emulator-diagnostics/layout-sizes.txt
  adb shell wm density | tee -a emulator-diagnostics/layout-sizes.txt
  adb shell wm size | tee -a emulator-diagnostics/layout-sizes.txt
  start_app "$label" || true
}
set_logical_viewport 360 780 compact
set_logical_viewport 320 480 small_window
# Check accessibility font scaling on a real Android compositor, not only
# a simulated CSS viewport. Restore original system setting after the test.
# Android 8 Google APIs emulator's launcher crashes in a loop if font_scale
# is edited by ADB after boot (confirmed in API 26 logcat). Do not claim that
# specific accessibility setting was validated there; still test all other
# sizes and report the omission explicitly. Newer APIs exercise true scaling.
if (( $(adb shell getprop ro.build.version.sdk | tr -d '\r') <= 28 )); then
  echo "SKIP large-text scenario: API 26 system launcher crashes on ADB font scale change"
else
  adb shell settings put system font_scale 1.3
  actual_font_scale="$(adb shell settings get system font_scale | tr -d '\r')"
if [[ "$actual_font_scale" == "1.3" ]]; then
  # Android may not notify the old WebView until Activity recreation. A
  # force-stop only on disposable CI ensures font metrics actually change.
  adb shell am force-stop "$PACKAGE" || true
  sleep 2
  start_app large_text_small_window || true
else
  echo "SKIP large-text scenario: emulator rejected font_scale 1.3 ($actual_font_scale)"
fi
  if [[ "$original_font_scale" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    adb shell settings put system font_scale "$original_font_scale" >/dev/null 2>&1 || true
    adb shell am force-stop "$PACKAGE" || true
  fi
fi
set_logical_viewport 1024 600 wide_tablet
set_logical_viewport 780 360 wide
# Restore native device DPI before rotation/navigation testing. Those tests
# must measure genuine OS status and gesture-bar dimensions, not 160dpi.
adb shell wm size reset
adb shell wm density reset
sleep 2
start_app restored_native_density || true
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
sleep 2
start_app orientation_90 || true
adb shell settings put system user_rotation 0
sleep 2
start_app orientation_0 || true
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
        echo "SKIP $mode: requested nav overlay not active, cannot claim mode coverage"
        continue
      fi
      # Mode changes can leave old WebView insets cached. Cold-start ensures
      # that all three gallery tab targets see the newly active OS controls.
      adb shell am force-stop "$PACKAGE" || true
      sleep 2
      start_app "$mode" || true
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
