"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { List, ListGroup, ListRow } from "@/components/ui/list";
import { updatesBlocked } from "@/components/ui/update-activity";
import { saveAutomaticBackup } from "@/lib/backup/automatic";
import { base, withBase } from "@/lib/base-path";
import type { TrackerState } from "@/lib/mogi/types";
import { message, precacheWhenIdle, warmCachedOCRWhenIdle } from "@/lib/offline/client";
import { decideUpdate, type UpdateTrigger } from "@/lib/offline/update";
import { settled } from "@/lib/settled";
export function useOfflinePanel({
  idle,
  state,
  beforeReload,
}: {
  idle: boolean;
  state: TrackerState;
  beforeReload: () => void;
}) {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const attemptedBuilds = useRef(new Set<string>());
  const [controller, setController] = useState<ServiceWorker | null>(null);
  const [waiting, setWaiting] = useState(false);
  const current = useRef({ idle, state, beforeReload });
  useLayoutEffect(() => {
    current.current = { idle, state, beforeReload };
  }, [idle, state, beforeReload]);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const sourceBuild = useRef("");
  const openingPending = useRef(false);
  const interactions = useRef(0);
  const inFlight = useRef(false);
  const [updateStatus, setUpdateStatus] = useState("");
  const [updating, setUpdating] = useState(false);
  const attemptUpdate = useCallback(async (trigger: UpdateTrigger) => {
    const reg = registrationRef.current;
    const next = reg?.waiting;
    const interaction = interactions.current;
    const eligible = () =>
      current.current.idle &&
      !updatesBlocked() &&
      (trigger !== "hidden" || document.visibilityState === "hidden") &&
      (trigger !== "opening" || interactions.current === 0) &&
      interactions.current === interaction;
    if (!next || inFlight.current || !eligible()) return;
    inFlight.current = true;
    setUpdating(true);
    let reload: (() => void) | undefined;
    return settled(
      async () => {
        try {
          const check = await message(next, "can-activate");
          const conditions = {
            waiting: reg.waiting === next,
            idle: eligible(),
            trigger,
            otherWindows: !!check.otherWindows,
            backup: "pending" as const,
          };
          const decision = decideUpdate(conditions);
          if (decision === "other-windows") {
            setUpdateStatus("Close the other windows of this app to finish the update");
            return;
          }
          if (decision !== "backup") return;
          setUpdateStatus("Saving a backup before the update…");
          try {
            await saveAutomaticBackup(current.current.state, sourceBuild.current);
          } catch {
            const failed = decideUpdate({ ...conditions, backup: "failed" });
            if (failed === "backup-failed")
              setUpdateStatus(
                "Couldn't save the backup. Free up space or use Save Backup in Storage, then try Restart Now.",
              );
            return;
          }
          if (
            decideUpdate({ ...conditions, waiting: reg.waiting === next, idle: eligible(), backup: "saved" }) !==
            "activate"
          ) {
            setUpdateStatus("");
            return;
          }
          let reloaded = false;
          reload = () => {
            if (reloaded) return;
            reloaded = true;
            current.current.beforeReload();
            window.location.reload();
          };
          navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
          await message(next, "activate");
        } catch (cause) {
          if (reload) navigator.serviceWorker.removeEventListener("controllerchange", reload);
          setUpdateStatus(cause instanceof Error ? cause.message : "Couldn't finish the update. Try Restart Now.");
        }
      },
      () => {
        inFlight.current = false;
        setUpdating(false);
      },
    );
  }, []);
  useEffect(() => {
    const interact = () => {
      interactions.current++;
      openingPending.current = false;
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") void attemptUpdate("hidden");
    };
    window.addEventListener("pointerdown", interact, true);
    window.addEventListener("keydown", interact, true);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pointerdown", interact, true);
      window.removeEventListener("keydown", interact, true);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [attemptUpdate]);
  useEffect(() => {
    if (registration && idle && openingPending.current) {
      openingPending.current = false;
      void attemptUpdate("opening");
    }
  }, [registration, idle, attemptUpdate]);
  useEffect(() => {
    const changed = () => setController(navigator.serviceWorker.controller);
    if (!("serviceWorker" in navigator)) return;
    changed();
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", changed);
  }, []);
  useEffect(() => {
    if (registration && controller && idle) return precacheWhenIdle(controller, attemptedBuilds.current);
  }, [registration, controller, idle]);
  useEffect(() => {
    if (registration && controller && idle) return warmCachedOCRWhenIdle();
  }, [registration, controller, idle]);
  useEffect(() => {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    async function inspect() {
      try {
        const version = await fetch(withBase("/offline-version.json"), {
          cache: "no-store",
        });
        if (!version.ok || !version.headers.get("content-type")?.includes("json")) return;
        const reg = await navigator.serviceWorker.register(withBase("/sw.js"), {
          scope: base,
          updateViaCache: "none",
        });
        if (cancelled) return;
        registrationRef.current = reg;
        openingPending.current = !!reg.waiting && interactions.current === 0;
        sourceBuild.current = ((await version.json()) as { build: string }).build;
        setRegistration(reg);
        setWaiting(!!reg.waiting);
        reg.addEventListener("updatefound", () =>
          reg.installing?.addEventListener("statechange", () => {
            if (!cancelled) setWaiting(!!reg.waiting);
          }),
        );
        if (navigator.serviceWorker.controller) {
          const result = await message(navigator.serviceWorker.controller, "status");
          if (!cancelled) {
            sourceBuild.current = result.build ?? sourceBuild.current;
          }
        }
      } catch {
        // Registration and inspection failures are silent; retry on next open.
      }
    }
    void inspect();
    return () => {
      cancelled = true;
    };
  }, []);
  // The controller stays mounted while Settings pages open and close; Settings shows the update under its rows.
  return {
    settings: waiting ? (
      <ListGroup note={updateStatus || undefined}>
        <List aria-label="App update">
          <ListRow
            trail={
              <Button
                variant="ghost-primary"
                className="h-11"
                disabled={!idle || updating}
                onClick={() => void attemptUpdate("manual")}
              >
                Restart Now
              </Button>
            }
          >
            Update ready
          </ListRow>
        </List>
      </ListGroup>
    ) : null,
  };
}
