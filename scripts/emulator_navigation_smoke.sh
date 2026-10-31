#!/usr/bin/env bash
# Real Android emulator UI smoke, no personal files touched.
set -euo pipefail
: "${ANDROID_SERIAL:=emulator-5554}"
PACKAGE=app.lovable.privacygallery
ACTIVITY="$PACKAGE/.MainActivity"
echo "Testing $(adb shell getprop ro.build.version.release | tr -d '\r') / API $(adb shell getprop ro.build.version.sdk | tr -d '\r')"
echo "WebView provider:"
adb shell dumpsys webviewupdate | head -25 || true
adb shell wm size
adb shell wm density
adb shell pm path "$PACKAGE" | grep '^package:' >/dev/null || {
  echo "APK missing: the test cannot proceed without installing the application"; exit 1;
}
adb shell am start -W -n "$ACTIVITY"
sleep 4
adb shell pidof "$PACKAGE" >/dev/null || { echo "App process crashed"; exit 1; }
# Emulate compact portrait and wide/landscape windows (reset in trap).
cleanup() {
  adb shell wm size reset >/dev/null || true
  adb shell wm density reset >/dev/null || true
}
trap cleanup EXIT
adb shell wm size 360x780
sleep 2
adb shell pidof "$PACKAGE" >/dev/null || { echo "Compact screen app crash"; exit 1; }
adb shell wm size 780x360
sleep 2
adb shell pidof "$PACKAGE" >/dev/null || { echo "Wide screen app crash"; exit 1; }
cleanup
# Navigation overlays are available only on some Android 10+ system images.
API="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
if [[ "$API" -ge 29 ]]; then
  for mode in threebutton gestural; do
    overlay="com.android.internal.systemui.navbar.$mode"
    if adb shell cmd overlay enable "$overlay" >/dev/null 2>&1; then
      echo "Enabled $mode system navigation"
      sleep 2
      adb shell pidof "$PACKAGE" >/dev/null || { echo "App crashed after navigation change"; exit 1; }
    else
      echo "SKIP $mode: navigation overlay not available on this emulator image"
    fi
  done
fi
echo "Emulator launch/navigation/resize smoke completed."
