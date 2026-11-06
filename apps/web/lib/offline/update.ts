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
