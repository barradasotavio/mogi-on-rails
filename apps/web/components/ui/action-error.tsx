"use client";

import { createContext, type ReactNode, useContext, useId } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";

/** The failed action's cause and the scope holding the control that triggered it. */
export interface ActionErrorReport {
  message: string;
  scope: string;
  key: number;
}

const ActionErrorContext = createContext<ActionErrorReport | null>(null);

/** The tracker's current inline error; every ActionScope reads it and shows it only when it owns it. */
export const ActionErrorProvider = ActionErrorContext.Provider;

/**
 * The scope of the control a person just used, or null when the action has no surface (a background
 * action, an alert's button, a control outside every scope). The tracker then uses a toast.
 */
export function actionScopeOf(trigger: Element | null): string | null {
  const scope = trigger?.isConnected ? trigger.closest("[data-action-scope]") : null;
  return scope?.getAttribute("data-action-scope") ?? null;
}

/** Whether the scope is still on screen to show its message. */
export function actionScopeMounted(scope: string) {
  return !!document.querySelector(`[data-action-scope="${CSS.escape(scope)}"]`);
}

/**
 * The inline error of one scope: one sentence in destructive text, right under the scope's controls.
 * `sheet` closes a sheet's content (8 px under its last group), `inset` follows the mogi screen's margins.
 */
export function ActionErrorText({
  scope,
  placement = "plain",
}: {
  scope: string;
  placement?: "plain" | "inset" | "sheet";
}) {
  const report = useContext(ActionErrorContext);
  if (report?.scope !== scope) return null;
  return (
    <InlineError key={report.key} placement={placement}>
      {report.message}
    </InlineError>
  );
}

/** One sentence in destructive text under the controls it is about, such as an answer the other facts rejected. */
export function InlineError({
  children,
  placement = "plain",
}: {
  children: ReactNode;
  placement?: "plain" | "inset" | "sheet";
}) {
  return (
    <p
      role="alert"
      className={cn(
        "text-sm text-destructive",
        placement === "sheet" ? "-mt-6 px-4" : "mt-2",
        placement === "inset" && "px-4",
      )}
    >
      {children}
    </p>
  );
}

/** A unique scope id; `data-action-scope={id}` marks the element whose controls own the error. */
export const useActionScope = () => useId();

/**
 * A group of controls whose failures appear right under them, until the next attempt.
 * `inset` aligns the sentence with inset content, such as the mogi screen's 16 px margins.
 */
export function ActionScope({ children, inset = false }: { children: ReactNode; inset?: boolean }) {
  const scope = useActionScope();
  return (
    <div data-action-scope={scope}>
      {children}
      <ActionErrorText scope={scope} placement={inset ? "inset" : "plain"} />
    </div>
  );
}
