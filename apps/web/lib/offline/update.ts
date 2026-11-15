export type UpdateTrigger = "opening" | "hidden" | "visible" | "manual";
export interface UpdateConditions {
  waiting: boolean;
  idle: boolean;
  trigger: UpdateTrigger;
  otherWindows: boolean;
  backup: "pending" | "saved" | "failed";
}

export function decideUpdate({ waiting, idle, trigger, otherWindows, backup }: UpdateConditions) {
  if (!waiting || !idle || trigger === "visible") return "wait";
  if (otherWindows) return "other-windows";
  if (backup === "failed") return "backup-failed";
  return backup === "saved" ? "activate" : "backup";
}

/** What Settings says when an update is held back; each reason names what is blocking and the way through. */
export const otherWindowsReason =
  "Close the other windows of this app to finish the update. Updating with them open could lose data.";
export function backupFailureReason(cause: unknown) {
  const name = cause instanceof DOMException ? cause.name : "";
  if (name === "QuotaExceededError")
    return "Couldn't save a backup first: this device is out of space. Free up space, then use Restart Now.";
  const detail = cause instanceof Error && cause.message ? cause.message.replace(/\.?$/, ".") : "";
  return `Couldn't save a backup first.${detail ? ` ${detail}` : ""} Use Restart Now to try again.`;
}
