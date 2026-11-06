import AppKit
import Darwin
import Foundation
import SwitchAirdropCore

private struct Options {
    var downloads: URL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    var log: URL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/SwitchAirdrop.log")
    var cutoff: Date?
    var once = false

    init(arguments: [String]) throws {
        var index = 0
        while index < arguments.count {
            let option = arguments[index]
            if option == "--once" {
                once = true
            } else if ["--downloads", "--log", "--cutoff"].contains(option) {
                index += 1
                guard index < arguments.count else { throw UsageError.invalid("Missing value for \(option)") }
                let value = arguments[index]
                switch option {
                case "--downloads": downloads = URL(fileURLWithPath: (value as NSString).expandingTildeInPath)
                case "--log": log = URL(fileURLWithPath: (value as NSString).expandingTildeInPath)
                default:
                    guard let seconds = Double(value), seconds.isFinite else {
                        throw UsageError.invalid("--cutoff requires finite seconds since 1970")
                    }
                    cutoff = Date(timeIntervalSince1970: seconds)
                }
            } else {
                throw UsageError.invalid("Unknown option: \(option)")
            }
            index += 1
        }
    }
}

private enum UsageError: Error, CustomStringConvertible {
    case invalid(String)
    var description: String {
        switch self {
        case .invalid(let message):
            return "\(message)\nUsage: SwitchAirdrop [--downloads PATH] [--log PATH] [--cutoff SECONDS] [--once]"
        }
    }
}

let launchTime = Date()
do {
    let options = try Options(arguments: Array(CommandLine.arguments.dropFirst()))
    let cutoff = options.cutoff ?? CutoffStore().effectiveCutoff(launchTime: launchTime)
    let sweeper = Sweeper(downloads: options.downloads, cutoff: cutoff, logger: FileMoveLogger(url: options.log))
    if options.once {
        try sweeper.sweep()
    } else {
        // A copy opened from Finder while launchd's copy runs would race it.
        if let identifier = Bundle.main.bundleIdentifier,
           NSRunningApplication.runningApplications(withBundleIdentifier: identifier)
               .contains(where: { $0.processIdentifier != getpid() }) {
            exit(EXIT_SUCCESS)
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let watcher = Watcher(sweeper: sweeper)
        let menuBar = MenuBar(watcher: watcher, sweeper: sweeper, log: options.log)
        try watcher.start()
        withExtendedLifetime(menuBar) { app.run() }
    }
} catch {
    report(error)
    exit(EXIT_FAILURE)
}
