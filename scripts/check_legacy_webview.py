#!/usr/bin/env python3
"""Ensure Android APK contains a *local*, non-ESM loader for old Android 7 WebView."""
from pathlib import Path
import re

root = Path("dist/client")
index = root / "index.html"
if not index.is_file():
    raise SystemExit("Android 7 compatibility: dist/client/index.html missing")
html = index.read_text("utf-8")
js = list(root.rglob("*legacy*.js"))
if not js:
    raise SystemExit("Android 7 compatibility: no local legacy SystemJS JS emitted")
if not any("polyfills" in file.name for file in js):
    raise SystemExit("Android 7 compatibility: no bundled legacy polyfills")
if not ("nomodule" in html or "System.import" in html or "polyfills-legacy" in html):
    raise SystemExit("Android 7 compatibility: HTML does not boot legacy scripts")
modern_only = re.findall(r'<script[^>]*type=["\']module["\'][^>]*>', html)
if modern_only and "nomodule" not in html and "System.import" not in html:
    raise SystemExit("Android 7 compatibility: only modern module scripts present")
print("Android 7 WebView: legacy runtime, offline polyfills and HTML bootstrap found.")
print("Device test still required for actual startup and navigation.")
