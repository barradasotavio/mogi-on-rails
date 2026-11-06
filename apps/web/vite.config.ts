import vinext from "vinext";
import { defineConfig } from "vite";

import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./scripts/vite/sites-vite-plugin";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

export default defineConfig({
  server: {
    ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
    ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
  },
  plugins: [vinext({ react: { compiler: { panicThreshold: "all_errors" } } }), sites({ mockAuth: false })],
});
