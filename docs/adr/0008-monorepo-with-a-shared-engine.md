# Monorepo with a shared engine

Supersedes [ADR 0001](0001-monorepo-and-inspection-lab.md).

MKW on Rails is two subprojects: the Vinext app and `@mkw/engine`, a recognition, calculation and inference library whose public interface serves the app. Rules had been tied to the product interface and lived in expensive browser tests; behind a library interface they are tested cheaply through the public API.

The HTML inspection lab that ADR 0001 also decided was removed. It was a second React and shadcn app inside the library, with its own build, lint, preset drift check, browser specs and UI dependencies, so every change to shared tokens or lint had to be mirrored there. Saved analysis cases and the observations-only analysis path served only the lab and went with it. `packages/engine` holds only the engine. Recognition on genuine images is checked in the app's browser specs.
