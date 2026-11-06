"use client";

import { createContext, useContext } from "react";

/** A secondary panel owns focus while the Menu closes, then returns to its trigger. */
export const MenuPanelContext = createContext({
  openPanel: () => {},
  restoreFocus: () => {},
});
export function useMenuPanel() {
  return useContext(MenuPanelContext);
}
