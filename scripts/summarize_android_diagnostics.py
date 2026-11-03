#!/usr/bin/env python3
"""Summarize measured emulator boot phases; never infer success from a process alone."""
from pathlib import Path
import json
import re
import sys

APP = "app.lovable.privacygallery"


def classify(log: str, result: str, foreground: str) -> dict:
    # AndroidRuntime names its failing process on the line AFTER FATAL.
    # Most of the Android 10/13 "fatal" reports were actually Google's
    # emulator Launcher, not Nova Gallery. Keep those distinct.
    fatal_processes = re.findall(
        r"FATAL EXCEPTION:[^\n]*\n[^\n]*Process:\s*([^,\s]+)", log
    )
    app_crashes = sum(p == APP or p.startswith(APP + ":") for p in fatal_processes)
    launcher_crashes = sum("launcher" in p.lower() for p in fatal_processes)
    phase_names = {
        "entry_loaded": "[NovaBoot] entry-loaded",
        "router_created": "[NovaBoot] router-created",
        "router_load_resolved": "[NovaBoot] router-load-resolved",
        "router_load_rejected": "[NovaBoot] router-load-rejected",
        "react_root_committed": "[NovaBoot] react-root-committed",
        "router_timeout": "[NovaBoot] router-route-timeout",
        "route_visible": "[NovaBoot] route-visible",
        "route_without_safe_layout": "[NovaBoot] state-waiting-for-layout",
        "route_without_shell": "[NovaBoot] state-waiting-for-shell",
        "route_not_rendered": "[NovaBoot] state-waiting-for-route",
        "layout_ready": "React navigation evidence: OK",
        "react_mounted": "React gallery UI mounted",
        "first_frame": "First gallery compositor frame confirmed",
    }
    phases = {name: log.count(marker) for name, marker in phase_names.items()}
    issues = re.findall(r"\[NovaLayout\] ([A-Z_]+)", log)

    if phases["router_load_rejected"]:
        diagnosis = "ROUTER_LOAD_REJECTED"
    elif app_crashes:
        diagnosis = "GALLERY_PROCESS_CRASH"
    elif phases["route_without_shell"] and not phases["react_mounted"]:
        diagnosis = "ROUTE_WITHOUT_PERSISTENT_ANDROID_SHELL"
    elif phases["route_without_safe_layout"] and not phases["react_mounted"]:
        diagnosis = "ROUTE_MOUNTED_BUT_NATIVE_LAYOUT_UNVERIFIED"
    elif phases["react_root_committed"] and not phases["route_visible"]:
        diagnosis = "ROUTE_NOT_VISIBLE_AFTER_REACT_COMMIT"
    elif phases["react_mounted"] and not phases["first_frame"]:
        diagnosis = "REACT_MOUNTED_WITHOUT_PAINT"
    elif issues and not phases["react_mounted"]:
        diagnosis = "UNVALIDATED_SYSTEM_BAR_OR_NAV_GEOMETRY"
    elif phases["first_frame"] and "Java tests: 0" in result and "script: 0" in result:
        diagnosis = "PASS_WITH_CONFIRMED_PAINT"
    elif phases["entry_loaded"] == 0:
        diagnosis = "ANDROID_JS_ENTRY_NOT_OBSERVED"
    else:
        diagnosis = "NEEDS_MANUAL_REVIEW"

    return {
        "result": result.strip(),
        "diagnosis": diagnosis,
        "boot_phases": phases,
        "layout_issue_types": sorted(set(issues)),
        "app_crashes": app_crashes,
        "launcher_crashes": launcher_crashes,
        "other_system_crashes": max(0, len(fatal_processes) - app_crashes - launcher_crashes),
        "native_fallback_count": log.count("Local WebView never rendered; showing native recovery UI"),
        "startup_software_retries": log.count("Startup software compositor fallback"),
        "paint_software_retries": log.count("One software-compositor retry"),
        "native_bridge_undefined": log.count("Cannot read property 'triggerEvent' of undefined"),
        "early_safe_area_errors": log.count("Error injecting safe area CSS"),
        "webview_renderer_errors": len(re.findall(
            r"render process gone|renderer process crash|Failed to find ColorBuffer", log, re.I)),
        "play_services_provider_kills": len(re.findall(
            r"Killing .*app\.lovable\.privacygallery.*depends on provider.*google", log)),
        "wrong_foreground": "FAIL: " in foreground,
    }


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "emulator-diagnostics")

    def read(name: str) -> str:
        path = root / name
        return path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""

    state = classify(read("logcat.txt"), read("result.txt"), read("foreground.txt"))
    root.mkdir(parents=True, exist_ok=True)
    (root / "classification.json").write_text(
        json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("Nova CI emulator diagnostics: " + json.dumps(state, sort_keys=True))


if __name__ == "__main__":
    main()
