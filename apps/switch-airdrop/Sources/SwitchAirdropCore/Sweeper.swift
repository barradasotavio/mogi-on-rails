import Darwin
import Foundation

public protocol MoveLogger {
    func recordMove(from source: URL, to destination: URL) throws
}

public struct FileMoveLogger: MoveLogger {
    public let url: URL

    public init(url: URL) { self.url = url }

    public func recordMove(from source: URL, to destination: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = .current
        let line = "\(formatter.string(from: Date()))\t\(escaped(source.lastPathComponent)) -> \(escaped(destination.lastPathComponent))\n"
        let descriptor = open(url.path, O_WRONLY | O_CREAT | O_APPEND | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw posixError() }
        defer { close(descriptor) }
        try Data(line.utf8).withUnsafeBytes { bytes in
            var offset = 0
            while offset < bytes.count {
                let count = write(descriptor, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { throw posixError() }
                offset += count
            }
        }
    }

    private func escaped(_ name: String) -> String {
        name.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\t", with: "\\t")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\n", with: "\\n")
    }
}

public enum MoveResult: Equatable {
    case moved(URL)
    case retryLater
    case skipped
}

public struct Sweeper {
    public let downloads: URL
    public let cutoff: Date
    private let logger: any MoveLogger

    public init(downloads: URL, cutoff: Date, logger: any MoveLogger) {
        // FSEvents reports physical paths (for example /private/var rather
        // than /var). Resolve the directory, never the candidate file itself.
        self.downloads = downloads.standardizedFileURL.resolvingSymlinksInPath()
        self.cutoff = cutoff
        self.logger = logger
    }

    public var destinationFolder: URL {
        downloads.appendingPathComponent("Nintendo Switch App", isDirectory: true)
    }

    public func topLevelFiles() throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: downloads, includingPropertiesForKeys: nil)
    }

    public func isTopLevel(_ url: URL) -> Bool {
        url.standardizedFileURL.deletingLastPathComponent().resolvingSymlinksInPath() == downloads
    }

    public func evaluate(_ url: URL) -> Qualification {
        guard isTopLevel(url), FileSnapshot(url: url) != nil else { return .skip }
        let quarantine = MetadataReader.quarantine(at: url)
        // Avoid ImageIO work for known non-AirDrops and pre-install files.
        let initial = qualification(isRegularFile: true, isTopLevel: true,
                                    quarantine: quarantine, make: nil, cutoff: cutoff)
        guard initial != .skip else { return .skip }
        guard quarantine != nil else { return .retryLater }
        return qualification(isRegularFile: true, isTopLevel: true, quarantine: quarantine,
                             make: MetadataReader.make(at: url), cutoff: cutoff)
    }

    @discardableResult
    public func process(_ url: URL) throws -> MoveResult {
        guard let snapshot = FileSnapshot(url: url) else { return .skipped }
        switch evaluate(url) {
        case .skip: return .skipped
        case .retryLater: return .retryLater
        case .qualifies: break
        }
        guard FileSnapshot(url: url) == snapshot else { return .retryLater }
        let folder = destinationFolder
        guard mkdir(folder.path, 0o755) == 0 || errno == EEXIST else { throw posixError() }
        var folderInfo = stat()
        guard lstat(folder.path, &folderInfo) == 0,
              (folderInfo.st_mode & S_IFMT) == S_IFDIR else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        var suffix = 1
        while true {
            let destination = folder.appendingPathComponent(Self.destinationName(for: url, suffix: suffix))
            // Unlike rename(), RENAME_EXCL never replaces an existing file,
            // including a competing move after we picked the suffix.
            if renamex_np(url.path, destination.path, UInt32(RENAME_EXCL)) == 0 {
                try logger.recordMove(from: url, to: destination)
                return .moved(destination)
            }
            let code = errno
            guard code == EEXIST else { throw posixError(code) }
            suffix += 1
        }
    }

    /// Reports transient candidates to callers that can retry; one-shot callers
    /// deliberately leave them for a later launch instead of waiting.
    @discardableResult
    public func sweep() throws -> [URL] {
        var pending: [URL] = []
        var firstError: Error?
        for url in try topLevelFiles() {
            do {
                if try process(url) == .retryLater { pending.append(url) }
            } catch {
                if firstError == nil { firstError = error }
            }
        }
        if let firstError { throw firstError }
        return pending
    }

    private static func destinationName(for source: URL, suffix: Int) -> String {
        guard suffix > 1 else { return source.lastPathComponent }
        let ext = source.pathExtension
        let stem = ext.isEmpty ? source.lastPathComponent : source.deletingPathExtension().lastPathComponent
        return "\(stem) \(suffix)" + (ext.isEmpty ? "" : ".\(ext)")
    }
}

private func posixError(_ code: Int32 = errno) -> NSError {
    NSError(domain: NSPOSIXErrorDomain, code: Int(code))
}
