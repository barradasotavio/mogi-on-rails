# Switch AirDrop

A background Mac helper that moves Nintendo Switch screenshots received by AirDrop from the top level of `~/Downloads` into `~/Downloads/Nintendo Switch App/`, where the web app's watched folder can read them. Chrome won't let a web page watch Downloads itself.

A file moves when all of these hold:

- it is a regular file at the top level of `~/Downloads`;
- its `com.apple.quarantine` agent is `sharingd` (AirDrop);
- its quarantine timestamp is at or after the install cutoff;
- its EXIF/TIFF `Make` starts with `Nintendo`.

On a name clash it appends ` 2`, ` 3`, …; it never overwrites, deletes or edits a file. AirDrops received before the first install stay in Downloads.

It is a Swift package, outside the npm workspaces and `npm run check`. Tests: `swift test` in this folder.

## Install and uninstall

```bash
apps/switch-airdrop/install.sh
```

Builds, ad-hoc signs, copies `Switch AirDrop.app` to `~/Applications`, stores the install cutoff, and registers and starts the LaunchAgent `io.github.barradasotavio.switch-airdrop`. It starts at login and restarts if it crashes. Running it again updates the app and keeps the original cutoff.

```bash
apps/switch-airdrop/uninstall.sh
```

Stops it and removes the LaunchAgent, the app, the stored cutoff and its Downloads permission. Moved files and the log stay.

## Menu bar

The helper has no Dock icon; a photo-with-arrow icon in the menu bar shows it is running. Its menu shows the last moved file and when it moved, and has Open “Nintendo Switch App” Folder, Open Log, Pause Watching / Resume Watching and Quit Switch AirDrop.

- **Pause** stops watching until Resume or the next start; files that arrived meanwhile move on resume.
- **Quit** stays quit until the next login. To start it sooner, open `~/Applications/Switch AirDrop.app`.

## Permission prompt

On first start macOS asks once whether **Switch AirDrop** may access the Downloads folder; allow it. It needs no Full Disk Access. A shell script under launchd can't get this permission, which is why the helper is an `.app` bundle with `NSDownloadsFolderUsageDescription`.

The ad-hoc signature changes on every build, so after a reinstall macOS may ask again. If access was denied, allow it in System Settings › Privacy & Security › Files & Folders.

## Log

```bash
tail ~/Library/Logs/SwitchAirdrop.log
```

One line per moved file: timestamp, a tab, `original -> destination`. Skipped files are not logged. Errors go to stderr, which launchd discards.

## Trying it on a scratch folder

The executable accepts `--downloads PATH`, `--log PATH`, `--cutoff SECONDS` (overrides the stored cutoff) and `--once` (one sweep, then exit). Build with `scripts/build-app.sh OUT_DIR` and run `OUT_DIR/Switch AirDrop.app/Contents/MacOS/SwitchAirdrop` against a temporary folder to test without touching `~/Downloads`.
