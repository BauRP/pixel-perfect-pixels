#!/usr/bin/env python3
"""Verify offline WebView startup includes a native ES-module entry for Chrome 69+."""
from pathlib import Path
from html.parser import HTMLParser
root = Path("dist/client")
html = (root / "index.html").read_text("utf8")
assets = root / "assets"
class Parser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.scripts.append(dict(attrs))
parser = Parser()
parser.feed(html)
scripts = parser.scripts
inline = [s for s in scripts if not s.get("src")]
if len(scripts) != 3 or len(inline) != 1 or inline[0].get("data-nova-boot-error") != "1":
    raise SystemExit("Android WebView: SSR/legacy scripts still present: " + str(scripts))
if scripts[-2].get("src") != "./assets/nova-core-polyfills.js":
    raise SystemExit("Android WebView: local core-js must load first")
entry = scripts[-1].get("src", "")
if scripts[-1].get("type") != "module" or not entry.startswith("./assets/index-"):
    raise SystemExit("Android WebView: expected native module entry: " + str(scripts[-1]))
if not (root / entry).is_file():
    raise SystemExit("Android WebView: entry not emitted: " + entry)
if not (assets / "nova-core-polyfills.js").is_file():
    raise SystemExit("Android WebView: offline polyfills missing")
if "nova-system.min.js" in html or "System.import" in html:
    raise SystemExit("Android WebView: incompatible SystemJS loader still in HTML")
print("OK: offline polyfills and native Chrome69+ ES module entry are included.")
print("This confirms packaging, not successful emulator launch.")
