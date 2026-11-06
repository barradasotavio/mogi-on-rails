# Monorepo with a shared engine and an inspection lab

Superseded by [ADR 0008](0008-monorepo-with-a-shared-engine.md): the lab was removed.

MKW on Rails is two subprojects: the Vinext app and `@mkw/engine`, a recognition, calculation and inference library whose public interface serves both the app and an HTML lab. Rules had been tied to the product interface and lived in expensive browser tests; behind a library interface they are tested cheaply and inspected without the app. The lab only inspects (images, observations, analysis, questions, exported cases); corrections and answers stay in the app, because a second editing interface would pull the lab away from inspecting the engine.
