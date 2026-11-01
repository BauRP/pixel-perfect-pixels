#!/usr/bin/env bash
# Shell-level Android smoke of ACTUAL installed APK; screenshots before exit.
# Never changes real user data: this runs only on disposable CI emulators.
set -euo pipefail
: "${ANDROID_SERIAL:=emulator-5554}"
PACKAGE=app.lovable.privacygallery
ACTIVITY="$PACKAGE/.MainActivity"
mkdir -p emulator-diagnostics
echo "Android $(adb shell getprop ro.build.version.release | tr -d '\r'), API $(adb shell getprop ro.build.version.sdk | tr -d '\r')"
adb shell dumpsys webviewupdate | head -25 || true
adb shell wm size
adb shell wm density
adb shell pm path "$PACKAGE" | grep '^package:' >/dev/null
cleanup() {
  adb shell wm size reset >/dev/null 2>&1 || true
  adb shell wm density reset >/dev/null 2>&1 || true
}
trap cleanup EXIT
start_app() {
  adb shell am start -W -n "$ACTIVITY"
  sleep 4
  adb shell pidof "$PACKAGE" >/dev/null || { echo "APK process crashed: $1"; return 1; }
  adb shell dumpsys window | grep -E 'mCurrentFocus|mFocusedApp' | head -4 || true
  adb shell screencap -p "/sdcard/nova-$1.png" >/dev/null 2>&1 || true
  adb pull "/sdcard/nova-$1.png" "emulator-diagnostics/$1.png" >/dev/null 2>&1 || true
}
start_app portrait
adb shell wm size 360x780
start_app compact
adb shell wm size 780x360
start_app wide
cleanup
API="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
if (( API >= 29 )); then
  for mode in threebutton gestural; do
    overlay="com.android.internal.systemui.navbar.$mode"
    if adb shell cmd overlay enable "$overlay" >/dev/null 2>&1; then
      echo "Requested navigation overlay: $mode"
      start_app "$mode"
      adb shell dumpsys window > "emulator-diagnostics/window-$mode.txt" || true
    else
      echo "SKIP $mode overlay: this Android emulator does not support it"
    fi
  done
fi
echo "APK launch, compact/wide resize and available navigation modes completed."
