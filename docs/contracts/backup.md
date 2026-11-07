# ZIP backup

The ZIP is the only mechanism for backup, transfer and recovery: the browser and the installed app keep separate data. Code in `lib/backup/` (`archive.ts` writes and inspects, `schema.ts` holds each record's shape as a valibot schema, `validation.ts` checks references between records, `automatic.ts` stores the automatic ones); tests in `validation-characterization.test.ts` (every rejection message), `data-contracts.spec.ts`, `storage.spec.ts` and `automatic-backups.production.spec.ts`. Screens and text in `components/backup-panel.tsx` and `components/automatic-backups.tsx`, shown in Settings › Storage.

## Restore

Settings › Storage saves every mogi on the device (Save Backup) and restores from a file (Restore from File…). The file is validated in full before the preview (summary, notes on pending and ignored items, an option to export the current state), and the replacement asks for destructive confirmation.

Invariants:

- **All or nothing**: a single IndexedDB transaction replaces the complete snapshot; React state changes only after `transaction.oncomplete`. The previous state stays intact until that transaction, and the result is exactly the file.
- **Cancel, back or failure preserves the current state.**
- Finishing closes Settings and shows the mogis, which are the confirmation; on saving, the browser's save or share sheet confirms, and there is no second save action. Errors go in an `Alert` at the top of the page where the action started.
- Preview and analysis survive a page change or closing Settings.

## Automatic backups before updating

Before activating a waiting worker, the app writes a complete ZIP (same format as the manual one) to a separate database and waits for the write to confirm. Retention follows [`AUTOMATIC_BACKUPS_KEPT`](../../apps/web/lib/backup/automatic.ts), on the device only; restoring keeps them. A creation, quota or write failure blocks that activation and leaves the update pending in Settings with a reason and a manual path ([offline.md](offline.md#navigation-and-updates)). Each automatic backup opens the same inspection, preview and replacement as the manual file.

## Contract

The ZIP carries `manifest.json` (`format`, `backupVersion`, `exportedAt`, `state`) and each image as a separate binary; layout in `createBackup`.

- `format` is `"mkw-on-rails"`, like the IndexedDB database name: both keep the app's former name so existing backups and stored data still open.
- `state` is the public domain records, independent of IndexedDB database names, stores and keys, and preserves every JSON field, unknown extensions included.
- `loungeNames` (Settings › Your Lounge Names) is an optional list of up to 20 texts of up to 80 characters; absent means none is set. A state saved with the single `loungeName` reads as a one-name list, and the next change of the names writes only `loungeNames`.
- A race's `nativePointOrigins: "manual"` is legacy: it still validates, and restore re-models the race's `nativePoints` from the scale ([native points](scoring.md#native-points)).
- `Capture.original` is `null` when the bytes were deleted to free space; the full record round-trips without a binary.
- SHA-256, size, decoding and dimensions of each binary are checked before the preview.
- `compressedFrom` marks a [compressed image](#compressed-images); without it, the original rules apply, so older backups with JPEG originals still restore.
- **Current** references require the capture record, even without bytes; historical snapshots may cite removed images. An explicitly removed capture goes in `deletedCaptureIds`; a missing source without that record is rejected. That way history holds and removed files stay removed.
- **Removal Undo** (`sourceUndo`) cites only races the mogi still has. Reconciliation drops a projected race once its last screenshot is removed, so every write and every load runs `settleSourceUndo` (`lib/mogi/source-lifecycle.ts`): it forgets references to dropped races, which Undo projects again, and releases an Undo the validator still refuses.
- Explicit error, rejecting the whole file: unknown format/version, broken references, altered images, files outside the manifest, fields without a JSON representation. Rules in `validateTracker`; size limits in `inspectBackup` (`archive.ts`) and entry/text limits in [`MAX_BACKUP_ITEMS`](../../apps/web/lib/backup/limits.ts) (real capacity depends on browser memory).
- Validation checks identities, sources and formulas; OCR accuracy stays outside it.

`fflate` is the only ZIP dependency and runs on the main thread, offline.

## Compressed images

When a mogi becomes a finished mogi, the app re-encodes each of its captures as WebP at quality 75, full resolution, and replaces the stored bytes. Code in `lib/mogi/compression.ts` (selection, merge) and `lib/mogi/compression-job.ts` (job), encoding in `lib/images/compressed.ts`. Readings, `photoMoment`, crops, results and questions were stored at intake, so none of them change.

- **Read once.** `compressedFrom: { sha256, size }` on a capture is the original file's fingerprint and marks the bytes as compressed. Recognition never runs on a marked image (`isCompressed`, `lib/images/compressed.ts`); a feature that re-reads stored images skips marked ones.
- **Original identity.** The duplicate check ("Image already in this mogi") and Undo match `compressedFrom.sha256` (`originalFingerprint`), so the original file is still recognized. A compressed capture's `fingerprint` equals `compressedFrom.sha256`.
- **Background, once per image.** A single job runs after loading and after every change, pauses while a reading is in progress, encodes one image at a time and saves each mogi's results in one quiet write over the latest state: no busy state, control or notice. A merge replaces only bytes that are still current; edits and removals win.
- **Lifecycle.** A mogi that returns to in progress keeps its compressed images; images added later are compressed when it finishes again. Pending images (`sharedReceipts`) stay as received. A failed image keeps its original and is retried on the next launch; closing midway resumes there. A browser that can't encode WebP (Safari returns PNG) keeps every original.
- **Backup.** The ZIP carries the WebP bytes. Validation requires WebP for a marked image, checks the bytes against the manifest's own SHA-256 and size, decodes them and checks dimensions like any image, and compares `fingerprint` with `compressedFrom.sha256` instead of the bytes. Restoring finished mogis with uncompressed images compresses them through the same job.

## Version

The writer always emits `backupVersion: 3` with `state.version: 1` (ZIP version ≠ database version); the reader accepts only that version. The app is unreleased, so formats from development builds are not read.

### Pending images

`sharedReceipts` stores the batch and the originals awaiting review, checked like those of captures; the preview counts the pending images without presenting them as races. Images chosen in a mogi are stored before OCR; confirming and consuming the pending batch is atomic; canceling keeps the originals.

### Evolution

- **New field**: preserve it in the model and the snapshot, add its shape to `schema.ts` and its references to `validation.ts`, and add a round trip through the public flow that observes the information in the app or the exported ZIP. `schema-agreement.ts` fails `npm run typecheck` while `types.ts` allows a state the schema refuses.
- **Message order**: restore shows the first failure, so a schema's field order and its guards keep the order of the checks; `validation-characterization.test.ts` pins each message.
- **Incompatible change**: a new version with deliberate reading or migration, once the app has users; an unknown version is rejected.

## Capture review

`Mogi.captureReview` is an optional JSON extension of the snapshot ([model](capture-sequence.md#drafts-and-capture-review)). Pending recognition and reviewed capture are distinct states; each source points only to its pending file or to the confirmed capture. The validator refuses broken references, repeated items or cursor, and pending files claimed by more than one mogi.

## Game screens

Interpretation stores only the `screen` from the [engine catalog](engine.md#game-screens). The ZIP validates the screen and observed-position constraints against that catalog; contradictory context is refused before the preview. The change of screen codes was made in place before release: the reader knows only the current codes, in the same ZIP version.

Saving and sharing on Android/iOS are proven only on a real device.
