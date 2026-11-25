/** Never restart a working route, Safe/privacy screen, recovery screen
 * or a gallery suspended in the background. */
export function shouldRetryNativeRoute(state: {
  visible: boolean;
  hasRoute: boolean;
  hasPrivacy: boolean;
  hasRecovery: boolean;
}): boolean {
  return state.visible && !state.hasRoute && !state.hasPrivacy && !state.hasRecovery;
}
