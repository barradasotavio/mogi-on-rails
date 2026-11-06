import type { ReactNode } from "react";

/**
 * Empty state in the iOS pattern (ContentUnavailableView): symbol, title, one sentence, then the actions.
 * It fills the space it is given and centers itself; the actions are GlassButtons, primary first.
 */
export function ContentUnavailable({
  icon,
  title,
  description,
  actions,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 px-8 py-12 text-center text-balance">
      <div className="flex max-w-sm flex-col items-center gap-2">
        <div aria-hidden="true" className="mb-2 text-muted-foreground [&_svg]:size-12">
          {icon}
        </div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  );
}
