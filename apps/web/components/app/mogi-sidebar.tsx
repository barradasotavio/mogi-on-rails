import { Plus, Settings2 } from "lucide-react";

import { MogiList } from "@/components/app/mogi-list";
import { GlassButton } from "@/components/ui/glass-button";
import { SidebarToggle } from "@/components/ui/toolbar";
import type { RouteView } from "@/lib/mogi/route";
import type { Mogi } from "@/lib/mogi/types";

/**
 * The same list in the docked sidebar and in the overlay. The header row lines up with the toolbar and holds
 * only its controls; docked, the sidebar's own toggle nearest the content, as in Notes and Mail (floating, the
 * toolbar's toggle stays in place and the overlay has none). The sidebar is
 * named "Mogis" for assistive technology and the list starts at its first section.
 */
export function MogiSidebar({
  mogis,
  activeId,
  view,
  onSelect,
  onView,
  onNew,
  onSettings,
  onToggle,
}: {
  mogis: Mogi[];
  activeId: string | null;
  view: RouteView | null;
  onSelect: (id: string) => void;
  onView: (view: RouteView) => void;
  onNew: () => void;
  onSettings: () => void;
  onToggle?: () => void;
}) {
  return (
    <div className="px-2 pb-6">
      <div className="sidebar-header toolbar-controls mb-7 flex items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <GlassButton shape="circle" aria-label="App Settings" onClick={onSettings}>
            <Settings2 aria-hidden="true" />
          </GlassButton>
          <GlassButton tint shape="circle" aria-label="New Mogi" onClick={onNew}>
            <Plus aria-hidden="true" />
          </GlassButton>
          {onToggle && <SidebarToggle placement="sidebar" onClick={onToggle} />}
        </div>
      </div>
      <MogiList mogis={mogis} activeId={activeId} view={view} onSelect={onSelect} onView={onView} sidebar />
    </div>
  );
}
