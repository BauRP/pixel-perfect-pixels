#!/usr/bin/env python3
"""Reject AndroidJUnitRunner false positives (tested with real API24 logs).

Android instrumentation's exit marker can be -1 even when JUnit reported
Failures: 1. Keep a separate verdict from emulator screenshot/foreground
checks; NEVER turn a failing Java test suite into a successful API result.
"""
import re
import sys
from pathlib import Path


def instrumentation_passed(log: str) -> bool:
    if not re.search(r"(?m)^INSTRUMENTATION_CODE:\\s*-1\\s*$", log):
        return False
    # Every actual JUnit test reports a completed status=0. Zero executed
    # tests must not certify an emulator with a broken instrumentation setup.
    if not re.search(r"(?m)^INSTRUMENTATION_STATUS_CODE:\\s*0\\s*$", log):
        return False
    if re.search(r"(?m)^INSTRUMENTATION_STATUS_CODE:\\s*-2\\s*$", log):
        return False
    if re.search(r"(?m)^INSTRUMENTATION_FAILED", log):
        return False
    if re.search(r"(?m)^INSTRUMENTATION_RESULT:.*(?:shortMsg|error)", log, re.I):
        return False
    for result in re.finditer(
        r"Tests run:\\s*(\\d+)\\s*,\\s*Failures:\\s*(\\d+)", log
    ):
        if int(result.group(2)) > 0:
            return False
    return True


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: check_android_instrumentation.py PATH")
    passed = instrumentation_passed(Path(sys.argv[1]).read_text(
        encoding="utf-8", errors="replace"))
    print("AndroidJUnitRunner tests PASS" if passed else
          "AndroidJUnitRunner tests FAIL or incomplete")
    raise SystemExit(0 if passed else 1)
