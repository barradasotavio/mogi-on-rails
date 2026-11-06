import AppKit
import SwitchAirdropCore

/// The status item shows that the helper is running; the app has no Dock icon
/// (LSUIElement), so this menu is its only interface.
final class MenuBar: NSObject, NSMenuDelegate {
    private let watcher: Watcher
    private let folder: URL
    private let log: URL
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private var lastMove: MoveLogEntry?
    private var paused = false

    init(watcher: Watcher, sweeper: Sweeper, log: URL) {
        self.watcher = watcher
        folder = sweeper.destinationFolder
        self.log = log
        lastMove = MoveLogEntry.last(in: log)
        super.init()
        let image = NSImage(systemSymbolName: "photo.badge.arrow.down", accessibilityDescription: "Switch AirDrop")
            ?? NSImage(systemSymbolName: "photo", accessibilityDescription: "Switch AirDrop")
        image?.isTemplate = true
        item.button?.image = image
        item.button?.toolTip = "Switch AirDrop"
        let menu = NSMenu()
        menu.delegate = self
        menu.autoenablesItems = false
        item.menu = menu
        watcher.onMove = { [weak self] entry in
            DispatchQueue.main.async { self?.lastMove = entry }
        }
    }

    /// Rebuilt on every open, so the last move and the pause state are current.
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        for line in Self.lastMoveLines(lastMove, paused: paused) {
            let row = NSMenuItem(title: line, action: nil, keyEquivalent: "")
            row.isEnabled = false
            menu.addItem(row)
        }
        menu.addItem(.separator())
        menu.addItem(action("Open “Nintendo Switch App” Folder", #selector(openFolder)))
        let openLog = action("Open Log", #selector(openLogFile))
        openLog.isEnabled = FileManager.default.fileExists(atPath: log.path)
        menu.addItem(openLog)
        menu.addItem(action(paused ? "Resume Watching" : "Pause Watching", #selector(togglePause)))
        menu.addItem(.separator())
        menu.addItem(action("Quit Switch AirDrop", #selector(quit), key: "q"))
    }

    private static func lastMoveLines(_ entry: MoveLogEntry?, paused: Bool) -> [String] {
        var lines: [String]
        if let entry {
            let formatter = DateFormatter()
            formatter.dateStyle = .medium
            formatter.timeStyle = .short
            formatter.doesRelativeDateFormatting = true
            lines = ["Last moved: \(entry.destination)", formatter.string(from: entry.date)]
        } else {
            lines = ["No screenshots moved yet"]
        }
        if paused { lines.insert("Paused", at: 0) }
        return lines
    }

    private func action(_ title: String, _ selector: Selector, key: String = "") -> NSMenuItem {
        let menuItem = NSMenuItem(title: title, action: selector, keyEquivalent: key)
        menuItem.target = self
        return menuItem
    }

    @objc private func openFolder() {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        NSWorkspace.shared.open(folder)
    }

    @objc private func openLogFile() {
        NSWorkspace.shared.open(log)
    }

    @objc private func togglePause() {
        if paused {
            do {
                try watcher.start()
                paused = false
            } catch {
                report(error)
            }
        } else {
            watcher.pause()
            paused = true
        }
        item.button?.appearsDisabled = paused
    }

    @objc private func quit() {
        // A clean exit keeps launchd from restarting it until the next login.
        NSApp.terminate(nil)
    }
}
