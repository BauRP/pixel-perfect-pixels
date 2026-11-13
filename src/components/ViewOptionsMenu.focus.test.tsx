import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViewOptionsMenu } from "./ViewOptionsMenu";

describe("three-dot menu focus decoration", () => {
  it.each(["folders", "media"] as const)(
    "does not draw a circular ring when the %s trigger regains focus",
    scope => {
      const { container } = render(<ViewOptionsMenu scope={scope} />);
      const trigger = container.querySelector<HTMLButtonElement>(
        'button[aria-haspopup="menu"]',
      );
      expect(trigger).not.toBeNull();
      // Radix deliberately restores the button focus after closing. Keep it
      // keyboard-operable without the persistent Android WebView focus halo.
      trigger!.focus();
      expect(trigger).toHaveFocus();
      expect(trigger!.style.outline).toBe("none");
      expect(trigger!.style.boxShadow).toBe("none");
      // jsdom does not expose WebKit-only tap highlight through CSSStyleDeclaration.
      // Verify the cross-browser focus styles here; Android APK build retains
      // the WebkitTapHighlightColor declaration in the trigger source.
      expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    },
  );
});
