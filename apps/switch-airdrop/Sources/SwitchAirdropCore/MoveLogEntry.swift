import Foundation

/// One line of the move log, read back so the menu can show the last move
/// after a restart.
public struct MoveLogEntry: Equatable {
    public let date: Date
    public let source: String
    public let destination: String

    public init(date: Date, source: String, destination: String) {
        self.date = date
        self.source = source
        self.destination = destination
    }

    public init?(line: Substring) {
        guard let tab = line.firstIndex(of: "\t"),
              let date = ISO8601DateFormatter().date(from: String(line[..<tab])) else { return nil }
        // A suffix never adds an arrow, so a name holding " -> " puts as many
        // arrows on each side: the separator is the middle one.
        let names = line[line.index(after: tab)...]
        let arrows = names.ranges(of: " -> ")
        guard arrows.count % 2 == 1 else { return nil }
        let separator = arrows[arrows.count / 2]
        self.date = date
        source = String(names[..<separator.lowerBound])
        destination = String(names[separator.upperBound...])
    }

    public static func last(in log: URL) -> MoveLogEntry? {
        guard let contents = try? String(contentsOf: log, encoding: .utf8) else { return nil }
        return contents.split(separator: "\n").reversed().lazy.compactMap { MoveLogEntry(line: $0) }.first
    }
}
