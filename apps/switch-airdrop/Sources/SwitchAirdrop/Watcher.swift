import CoreServices
import Foundation
import SwitchAirdropCore

/// All state and filesystem work belongs to one serial queue. A path has at
/// most one pending retry, and duplicate FSEvents never extend its deadline.
final class Watcher {
    private struct Pending {
        let token: UUID
        let deadline: TimeInterval
        var snapshot: FileSnapshot?
    }

    private let sweeper: Sweeper
    private let queue = DispatchQueue(label: "io.github.barradasotavio.switch-airdrop.events")
    private var stream: FSEventStreamRef?
    private var pending: [URL: Pending] = [:]
    /// Called on the watcher's queue after each move.
    var onMove: ((MoveLogEntry) -> Void)?

    init(sweeper: Sweeper) { self.sweeper = sweeper }

    func start() throws {
        try queue.sync { try startStream() }
    }

    /// Stops watching; files that arrive while paused are picked up by the
    /// sweep on resume.
    func pause() {
        queue.sync {
            guard let stream else { return }
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
            self.stream = nil
            pending.removeAll()
        }
    }

    private func startStream() throws {
        guard stream == nil else { return }
        var context = FSEventStreamContext(
            version: 0, info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil, release: nil, copyDescription: nil
        )
        let flags = kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer
            | kFSEventStreamCreateFlagUseCFTypes
        guard let stream = FSEventStreamCreate(
            nil,
            { _, info, count, paths, flags, _ in
                guard let info else { return }
                let watcher = Unmanaged<Watcher>.fromOpaque(info).takeUnretainedValue()
                let urls = unsafeBitCast(paths, to: NSArray.self) as! [String]
                for index in 0..<count {
                    let flag = flags[index]
                    if flag & FSEventStreamEventFlags(kFSEventStreamEventFlagMustScanSubDirs
                        | kFSEventStreamEventFlagUserDropped | kFSEventStreamEventFlagKernelDropped) != 0 {
                        watcher.scan()
                    }
                    watcher.enqueue(URL(fileURLWithPath: urls[index]))
                }
            },
            &context, [sweeper.downloads.path] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.15,
            FSEventStreamCreateFlags(flags)
        ) else { throw WatchError.cannotCreateStream }
        self.stream = stream
        FSEventStreamSetDispatchQueue(stream, queue)
        guard FSEventStreamStart(stream) else {
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
            self.stream = nil
            throw WatchError.cannotStartStream
        }
        // Watch first, then enumerate, so arrivals during the launch sweep
        // cannot fall into a gap. The sweep uses the same stability/retry path.
        queue.async { self.scan() }
    }

    private func scan() {
        do {
            for url in try sweeper.topLevelFiles() { enqueue(url) }
        } catch { report(error) }
    }

    private func enqueue(_ candidate: URL) {
        guard sweeper.isTopLevel(candidate) else { return }
        let url = sweeper.downloads.appendingPathComponent(candidate.lastPathComponent)
        guard pending[url] == nil else { return }
        let token = UUID()
        pending[url] = Pending(token: token, deadline: ProcessInfo.processInfo.systemUptime + 5,
                               snapshot: FileSnapshot(url: url))
        schedule(url, token: token, delay: 0.15)
    }

    private func schedule(_ url: URL, token: UUID, delay: Double = 0.25) {
        queue.asyncAfter(deadline: .now() + delay) { self.check(url, token: token) }
    }

    private func check(_ url: URL, token: UUID) {
        guard var work = pending[url], work.token == token else { return }
        let current = FileSnapshot(url: url)
        let result = sweeper.evaluate(url)
        if result == .skip {
            pending.removeValue(forKey: url)
            return
        }
        if result == .qualifies, current != nil, current == work.snapshot {
            do {
                let result = try sweeper.process(url)
                if case .moved(let destination) = result {
                    onMove?(MoveLogEntry(date: Date(), source: url.lastPathComponent,
                                         destination: destination.lastPathComponent))
                }
                if result != .retryLater {
                    pending.removeValue(forKey: url)
                    return
                }
            } catch {
                report(error)
                pending.removeValue(forKey: url)
                return
            }
        }
        guard ProcessInfo.processInfo.systemUptime < work.deadline else {
            pending.removeValue(forKey: url)
            return
        }
        work.snapshot = current
        pending[url] = work
        schedule(url, token: token)
    }
}

private enum WatchError: Error, CustomStringConvertible {
    case cannotCreateStream
    case cannotStartStream

    var description: String {
        switch self {
        case .cannotCreateStream: return "Could not create the Downloads FSEvents stream."
        case .cannotStartStream:
            return "Could not start the Downloads FSEvents stream. Check that this process can access the directory and the macOS FSEvents service."
        }
    }
}

func report(_ error: Error) {
    // The move log contains successful moves only; operational failures go to stderr.
    FileHandle.standardError.write(Data("Switch AirDrop: \(error)\n".utf8))
}
