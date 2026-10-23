/** Latest-request-wins coordinator for navigations with multiple async fetches.
 * Starting another playback cancels the previous network requests and makes
 * their late responses ineligible to modify the active player or its UI.
 */
export interface PlaybackLease {
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
}

export class PlaybackRequestGate {
  private generation = 0;
  private controller: AbortController | null = null;

  begin(): PlaybackLease {
    this.controller?.abort();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    return {
      signal: controller.signal,
      isCurrent: () => generation === this.generation && !controller.signal.aborted,
    };
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    this.generation++;
  }
}
