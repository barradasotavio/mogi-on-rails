export interface OfflineReply {
  ready?: boolean;
  prepared?: boolean;
  progress?: number;
  total?: number;
  build?: string;
  error?: string;
  otherWindows?: boolean;
}
export function message(
  worker: ServiceWorker,
  type: string,
  progress?: (value: OfflineReply) => void,
): Promise<OfflineReply> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error("No response. Check your connection and try again."));
    }, 120000);
    channel.port1.onmessage = (event: MessageEvent<OfflineReply>) => {
      if (event.data.progress !== undefined) {
        progress?.(event.data);
        return;
      }
      clearTimeout(timeout);
      channel.port1.close();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}
export async function warmOCR() {
  const { prepareRecognition } = await import("@mkw/engine/browser");
  await prepareRecognition();
}

/** Only the controlling worker's verified, current cache can supply every runtime
 * dependency without a download. `status` reads CacheStorage; it never fetches. */
export function warmCachedOCRWhenIdle() {
  let cancelled = false;
  async function prepare() {
    try {
      const worker = navigator.serviceWorker.controller;
      if (!worker) return;
      const cached = await message(worker, "status");
      if (!cancelled && cached.ready) await warmOCR();
    } catch {
      // Optional preparation must not interfere with opening or on-demand retries.
    }
  }
  const nativeIdle = typeof window.requestIdleCallback === "function";
  const ticket = nativeIdle
    ? window.requestIdleCallback(() => {
        void prepare();
      })
    : window.setTimeout(() => {
        void prepare();
      }, 0);
  return () => {
    cancelled = true;
    if (nativeIdle) window.cancelIdleCallback(ticket);
    else window.clearTimeout(ticket);
  };
}

/** One silent attempt per content version on this open. The durable completion
 * marker is still written only after verified downloads and functional OCR. */
export function precacheWhenIdle(worker: ServiceWorker, attempted: Set<string>) {
  let cancelled = false;
  async function prepare() {
    try {
      const cached = await message(worker, "status");
      if (cancelled || !cached.build || attempted.has(cached.build)) return;
      const build = cached.build;
      const download = async () => {
        if (cancelled || attempted.has(build)) return;
        const status = await message(worker, "status");
        if (cancelled) return;
        attempted.add(build);
        if (status.ready) return;
        await message(worker, "prepare");
        try {
          await warmOCR();
          await message(worker, "finalize");
          void navigator.storage?.persist?.().catch(() => false);
        } catch {
          await message(worker, "discard-incomplete");
        }
      };
      // Multiple windows share the verified generation and its warm-up check.
      if (navigator.locks) await navigator.locks.request(`mkw-precache-${cached.build}`, download);
      else await download();
    } catch {
      // Leave personal data and complete generations untouched; retry next open.
    }
  }
  const nativeIdle = typeof window.requestIdleCallback === "function";
  const ticket = nativeIdle
    ? window.requestIdleCallback(() => {
        void prepare();
      })
    : window.setTimeout(() => {
        void prepare();
      }, 0);
  return () => {
    cancelled = true;
    if (nativeIdle) window.cancelIdleCallback(ticket);
    else window.clearTimeout(ticket);
  };
}
