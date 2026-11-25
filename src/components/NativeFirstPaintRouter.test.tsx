import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ready: false,
  imports: 0,
}));
vi.mock("../lib/native-first-paint", () => ({
  useNativeFirstPaint: () => state.ready,
}));
vi.mock("../native-router-provider", () => {
  state.imports++;
  return { NativeRouterProvider: () => <div data-testid="real-routes">Gallery routes loaded</div> };
});

import { NativeFirstPaintRouter } from "./NativeFirstPaintRouter";

describe("Android first-frame route isolation", () => {
  it("renders an offline startup surface before loading any gallery routes", async () => {
    state.ready = false;
    const reported = vi.fn();
    const { rerender } = render(<NativeFirstPaintRouter onRouterLoaded={reported} />);
    expect(screen.getByRole("status").textContent).toContain("Nova Gallery");
    expect(screen.queryByTestId("real-routes")).toBeNull();
    expect(state.imports).toBe(0);
    expect(reported).not.toHaveBeenCalled();

    state.ready = true;
    rerender(<NativeFirstPaintRouter onRouterLoaded={reported} />);
    await waitFor(() => expect(screen.getByTestId("real-routes")).toBeInTheDocument());
    expect(state.imports).toBe(1);
    expect(reported).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("never restarts route import when the parent updates its startup callback", async () => {
    state.ready = true;
    const initial = vi.fn();
    const updated = vi.fn();
    const { rerender, unmount } = render(<NativeFirstPaintRouter onRouterLoaded={initial} />);
    await waitFor(() => expect(screen.getByTestId("real-routes")).toBeInTheDocument());
    expect(initial).toHaveBeenCalledTimes(1);
    rerender(<NativeFirstPaintRouter onRouterLoaded={updated} />);
    rerender(<NativeFirstPaintRouter onRouterLoaded={() => {}} />);
    expect(updated).not.toHaveBeenCalled();
    expect(initial).toHaveBeenCalledTimes(1);
    unmount();
  });

});
