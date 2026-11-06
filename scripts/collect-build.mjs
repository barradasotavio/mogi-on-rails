import { cp, rm } from "node:fs/promises";
// Preserve the hosting artifact at the repository entrypoint.
await rm("dist", { recursive: true, force: true });
await cp("apps/web/dist", "dist", { recursive: true });
