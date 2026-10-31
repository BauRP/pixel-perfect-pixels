#!/usr/bin/env python3
"""Validate actual TanStack SPA HTML bootstraps on Android 7+ WebView offline."""
from pathlib import Path
from html.parser import HTMLParser
import re
root = Path("dist/client")
html_file = root / "index.html"
if not html_file.is_file():
    raise SystemExit("Android legacy check: missing dist/client/index.html")
html = html_file.read_text("utf8")
assets = root / "assets"
class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.scripts.append(dict(attrs))
parser = Scripts()
parser.feed(html)
expected = ["nova-core-polyfills.js", "nova-system.min.js", "nova-bootstrap.js"]
scripts = [tag.get("src", "") for tag in parser.scripts]
for name in expected:
    if not (assets / name).is_file():
        raise SystemExit("Android 7 compatibility: missing bundled asset " + name)
    if not any(src.endswith(name) for src in scripts):
        raise SystemExit("Android 7 compatibility: loader omitted from HTML: " + name)
if any(tag.get("type") == "module" for tag in parser.scripts):
    raise SystemExit("Android 7 compatibility: modern module script still in app index")
entry = list(assets.glob("index-legacy-*.js"))
if len(entry) != 1:
    raise SystemExit("Android 7 compatibility: expected exactly one legacy JS entry")
boot = (assets / "nova-bootstrap.js").read_text("utf8")
if entry[0].name not in boot or "System.import" not in boot:
    raise SystemExit("Android 7 compatibility: SystemJS doesn't load the actual entry")
if not all((assets / name).stat().st_size > 100 for name in expected[:2]):
    raise SystemExit("Android 7 compatibility: legacy libs empty")
print("Verified: offline core-js -> SystemJS -> actual legacy entry for Android 7–17.")
print("Runtime WebView/device tests must still pass before declaring compatibility.")
