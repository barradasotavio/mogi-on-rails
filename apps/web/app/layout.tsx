// The direct import keeps the URLs' origin so the build emits the local fonts.
// We keep the package's subsets for Lounge names, accented ones included.
import "@fontsource-variable/inter";

import type { Metadata, Viewport } from "next";

import { appearanceColors, appearancePreference } from "@/lib/appearance";
import { withBase } from "@/lib/base-path";
import { installPromptScript } from "@/lib/install";
import { startupImages } from "@/lib/startup-images";

import globalStyles from "./globals.css?url";

const appearanceScript = `(() => {
  const preference = ${JSON.stringify(appearancePreference)};
  let value;
  try { value = localStorage.getItem(preference.key); } catch {}
  const dark = value === preference.dark ||
    (value !== preference.light && matchMedia("(prefers-color-scheme: dark)").matches);
  const theme = dark ? preference.dark : preference.light;
  document.documentElement.classList.add(theme);
  const colors = ${JSON.stringify(appearanceColors)};
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    meta.setAttribute("content", colors[theme]);
  });
  // Under Window Controls Overlay the toolbar becomes the title bar band; the user can toggle it at any time.
  const overlay = navigator.windowControlsOverlay;
  if (overlay) {
    const titlebar = () => overlay.visible
      ? document.documentElement.setAttribute("data-titlebar", "overlay")
      : document.documentElement.removeAttribute("data-titlebar");
    titlebar();
    overlay.addEventListener("geometrychange", titlebar);
  }
  // The page loads without viewport-fit=cover and gets it afterwards: arriving in the HTML, it inherits the
  // shortened height of the Sites login page; applied afterwards, the web view covers the screen again.
  // The new meta goes last because hydration inserts another copy of the original and the last one wins.
  addEventListener("load", () => {
    const viewport = document.createElement("meta");
    viewport.name = "viewport";
    viewport.content = "width=device-width, initial-scale=1, viewport-fit=cover";
    document.head.append(viewport);
  });
})();`;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // viewport-fit=cover comes from the appearance script, in a meta added after load.
  // The values are --background in the light and dark themes.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: appearanceColors.light },
    { media: "(prefers-color-scheme: dark)", color: appearanceColors.dark },
  ],
};

export const metadata: Metadata = {
  title: "Mogi on Rails",
  description: "Your mogi, race by race. Lounge results stay on your device.",
  manifest: withBase("/manifest.webmanifest"),
  appleWebApp: {
    capable: true,
    title: "Mogi on Rails",
    statusBarStyle: "black-translucent",
    startupImage: startupImages,
  },
  icons: { icon: withBase("/favicon.svg"), apple: withBase("/icons/apple-touch-icon.png") },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="font-sans" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceScript }} />
        <script dangerouslySetInnerHTML={{ __html: installPromptScript }} />
        {/* An explicit URL keeps theme CSS after the blocking script; resource
            imports would be hoisted ahead of it by the renderer. */}
        <link rel="stylesheet" href={globalStyles} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
