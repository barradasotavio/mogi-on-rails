/** Errors the tracker store raises; free of IndexedDB so session rules can classify them anywhere. */
export class UnsupportedTrackerVersionError extends Error {
  constructor() {
    super(
      "This data was saved by a newer version of the app. Connect to the internet and reload to update. Your data is still on this device.",
    );
    this.name = "UnsupportedTrackerVersionError";
  }
}
export class ConcurrentTrackerWriteError extends Error {
  constructor() {
    super(
      "Your data changed in another window. Reload before continuing. Confirmed results and pending screenshots are kept.",
    );
    this.name = "ConcurrentTrackerWriteError";
  }
}
