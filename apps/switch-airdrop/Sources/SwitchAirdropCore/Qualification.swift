import Foundation

public struct QuarantineInfo: Equatable {
    public let flags: UInt64
    public let timestamp: Date
    public let agent: String
    public let uuid: String?

    public init?(_ value: String) {
        let fields = value.split(separator: ";", omittingEmptySubsequences: false)
        guard (3...4).contains(fields.count),
              let flags = Self.hex(fields[0]),
              let seconds = Self.hex(fields[1]),
              !fields[2].isEmpty,
              !fields[2].contains(where: { $0.isNewline || $0 == "\0" })
        else { return nil }
        self.flags = flags
        self.timestamp = Date(timeIntervalSince1970: TimeInterval(seconds))
        self.agent = String(fields[2])
        self.uuid = fields.count == 4 && !fields[3].isEmpty ? String(fields[3]) : nil
    }

    private static func hex(_ value: Substring) -> UInt64? {
        guard !value.isEmpty, value.utf8.allSatisfy({
            (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0)
        }) else { return nil }
        return UInt64(value, radix: 16)
    }
}

public enum Qualification: Equatable {
    case qualifies
    case retryLater
    case skip
}

/// Missing metadata may be an AirDrop that is still being written. Definite
/// mismatches are final, so unrelated downloads don't consume a retry window.
public func qualification(
    isRegularFile: Bool,
    isTopLevel: Bool,
    quarantine: String?,
    make: String?,
    cutoff: Date
) -> Qualification {
    guard isRegularFile, isTopLevel else { return .skip }
    guard let quarantine else { return .retryLater }
    guard let info = QuarantineInfo(quarantine),
          info.agent == "sharingd", info.timestamp >= cutoff else { return .skip }
    guard let make else { return .retryLater }
    return make.hasPrefix("Nintendo") ? .qualifies : .skip
}
