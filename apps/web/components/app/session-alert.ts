import type { BlockingAlertContent } from "@/components/ui/blocking-alert";
import { titleCase } from "@/lib/format";
import type { StorageFailure } from "@/lib/mogi/session";

import type { TrackerSessionHandle } from "./use-tracker-session";

// Quota and unknown can lose the last change: caution, Try Again by default and Manage Storage as the way out.
const storageAlerts: Record<StorageFailure, { title: string; description: string; action: "Try Again" | "Reload" }> = {
  quota: { title: "This Device Is Out of Space", description: "Your last change wasn't saved.", action: "Try Again" },
  updated: {
    title: "Mogi on Rails Was Updated in Another Tab",
    description: "Reload to keep saving.",
    action: "Reload",
  },
  unknown: {
    title: "Couldn't Save on This Device",
    description: "Your last change wasn't saved.",
    action: "Try Again",
  },
};

/** At most one blocking alert, the most severe first; it stays until its action or its cause clearing. */
export function sessionAlert(
  session: TrackerSessionHandle,
  {
    onManageStorage,
    onRecover,
  }: {
    onManageStorage: () => void;
    onRecover: (pending: NonNullable<TrackerSessionHandle["recovery"]>) => void;
  },
): BlockingAlertContent | null {
  const { failedWrite, concurrentWrite, recovery } = session;
  const reload = { label: "Reload", onSelect: () => window.location.reload() };
  if (failedWrite) {
    const storageAlert = storageAlerts[failedWrite.cause];
    return {
      title: storageAlert.title,
      description: storageAlert.description,
      caution: storageAlert.action === "Try Again",
      // Try Again repeats the same write; failing again keeps the alert with the same cause.
      primary: storageAlert.action === "Reload" ? reload : { label: "Try Again", onSelect: failedWrite.retry },
      secondary:
        storageAlert.action === "Reload"
          ? undefined
          : {
              label: "Manage Storage",
              onSelect: () => {
                session.dismissFailedWrite();
                onManageStorage();
              },
            },
    };
  }
  if (concurrentWrite)
    return {
      title: "Your Data Changed in Another Window",
      description: "Reload before continuing. Confirmed results and pending screenshots are kept.",
      primary: reload,
    };
  if (recovery)
    return {
      title: titleCase(recovery.recovery.message.replace(/\.$/, "")),
      description: "Open the current version to continue.",
      primary: {
        label: recovery.recovery.label,
        onSelect: () => {
          session.dismissRecovery();
          onRecover(recovery);
        },
      },
    };
  return null;
}
