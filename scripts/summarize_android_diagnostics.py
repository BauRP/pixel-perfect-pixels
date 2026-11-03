#!/usr/bin/env python3
"""Categorize emulator failures using captured logs, never infer success from CI exit alone."""
from pathlib import Path
import json
import re
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "emulator-diagnostics")
log = (root / "logcat.txt").read_text(encoding="utf-8", errors="replace") if (root / "logcat.txt").exists() else ""
result = (root / "result.txt").read_text(encoding="utf-8", errors="replace") if (root / "result.txt").exists() else ""
focus = (root / "foreground.txt").read_text(encoding="utf-8", errors="replace") if (root / "foreground.txt").exists() else ""
state = {
    "result": result.strip(),
    "react_mounted_count": log.count("React gallery UI mounted"),
    "first_frame_count": log.count("First gallery compositor frame confirmed"),
    "native_fallback_count": log.count("Local WebView never rendered; showing native recovery UI"),
    "software_compositor_retries": log.count("One software-compositor retry"),
    "native_bridge_undefined": log.count("Cannot read property 'triggerEvent' of undefined"),
    "early_safe_area_errors": log.count("Error injecting safe area CSS"),
    "fatal_exceptions": log.count("FATAL EXCEPTION"),
    "webview_renderer_error": len(re.findall(r"render process gone|renderer process crash|Failed to find ColorBuffer", log, re.I)),
    "play_services_provider_kills": len(re.findall(r"Killing .*app\.lovable\.privacygallery.*depends on provider.*google", log)),
    "wrong_foreground": "FAIL: " in focus,
}
(root / "classification.json").write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
print("Nova CI emulator diagnostics: " + json.dumps(state, sort_keys=True))
