import CoreGraphics
import Darwin
import ImageIO
import UniformTypeIdentifiers
import XCTest
@testable import SwitchAirdropCore

final class SwitchAirdropCoreTests: XCTestCase {
    private var root: URL!
    private var downloads: URL!
    private var log: URL!
    private let cutoff = Date(timeIntervalSince1970: 1_700_000_000)

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("switch-airdrop-tests-\(UUID())")
        downloads = root.appendingPathComponent("downloads", isDirectory: true)
        log = root.appendingPathComponent("logs/moves.log")
        try FileManager.default.createDirectory(at: downloads, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let root { try FileManager.default.removeItem(at: root) }
    }

    func testQuarantineParser() throws {
        let uuid = "5C0F4CF0-2BE6-4D4F-A858-E36F03626A04"
        let info = try XCTUnwrap(QuarantineInfo("0081;6aeae513;sharingd;\(uuid)"))
        XCTAssertEqual(info.flags, 0x81)
        XCTAssertEqual(info.timestamp.timeIntervalSince1970, Double(0x6aeae513))
        XCTAssertEqual(info.agent, "sharingd")
        XCTAssertEqual(info.uuid, uuid)
        XCTAssertNil(try XCTUnwrap(QuarantineInfo("0081;6AEAE513;sharingd")).uuid)
        XCTAssertNil(try XCTUnwrap(QuarantineInfo("0081;6aeae513;sharingd;")).uuid)
        XCTAssertEqual(QuarantineInfo("0081;6aeae513;Microsoft Edge")?.agent, "Microsoft Edge")
        for malformed in ["", "0081;6aeae513", ";6aeae513;sharingd", "xx;6aeae513;sharingd",
                          "0081;;sharingd", "0081;0x123;sharingd", "0081;-1;sharingd",
                          "0081; 123;sharingd", "0081;10000000000000000;sharingd",
                          "0081;6aeae513;", "0081;6aeae513;sharingd;uuid;extra"] {
            XCTAssertNil(QuarantineInfo(malformed), malformed)
        }
    }

    func testQualificationRule() {
        let cases: [(Bool, Bool, String?, String?, Qualification)] = [
            (true, true, quarantine(), "Nintendo co., ltd", .qualifies),
            (true, true, quarantine(seconds: 1_700_000_000), "Nintendo", .qualifies),
            (true, true, quarantine(agent: "Microsoft Edge"), "Nintendo co., ltd", .skip),
            (true, true, quarantine(), "Apple", .skip),
            (true, true, quarantine(), "nintendo", .skip),
            (true, true, quarantine(seconds: 1_699_999_999), "Nintendo co., ltd", .skip),
            (false, true, quarantine(), "Nintendo co., ltd", .skip),
            (true, false, quarantine(), "Nintendo co., ltd", .skip),
            (true, true, nil, "Nintendo co., ltd", .retryLater),
            (true, true, quarantine(), nil, .retryLater),
            (true, true, quarantine(agent: "Microsoft Edge"), nil, .skip),
            (true, true, "bad", nil, .skip),
        ]
        for (regular, topLevel, attribute, make, expected) in cases {
            XCTAssertEqual(qualification(isRegularFile: regular, isTopLevel: topLevel,
                                         quarantine: attribute, make: make, cutoff: cutoff), expected)
        }
    }

    func testSyntheticSweepMovesOnlyQualifyingImageAndLogsExactlyOnce() throws {
        let good = try image("switch.jpg")
        let originalBytes = try Data(contentsOf: good)
        let edge = try image("browser.jpg", agent: "Microsoft Edge")
        let otherMake = try image("camera.jpg", make: "Apple")
        let old = try image("old.jpg", seconds: 1_699_999_999)
        let noQuarantine = try image("untagged.jpg", agent: nil)
        let noMake = try image("no-make.jpg", make: nil)
        let directory = downloads.appendingPathComponent("folder", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        let nested = try image("nested.jpg", parent: directory)
        let symlink = downloads.appendingPathComponent("link.jpg")
        try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: edge)

        let sweeper = makeSweeper()
        XCTAssertEqual(sweeper.evaluate(good.resolvingSymlinksInPath()), .qualifies)
        XCTAssertEqual(sweeper.evaluate(nested), .skip)
        XCTAssertEqual(sweeper.evaluate(symlink), .skip)
        try sweeper.sweep()
        let moved = downloads.appendingPathComponent("Nintendo Switch App/switch.jpg")
        XCTAssertFalse(FileManager.default.fileExists(atPath: good.path))
        XCTAssertEqual(try Data(contentsOf: moved), originalBytes)
        XCTAssertEqual(MetadataReader.quarantine(at: moved), quarantine())
        for sibling in [edge, otherMake, old, noQuarantine, noMake, directory, nested, symlink] {
            XCTAssertTrue(FileManager.default.fileExists(atPath: sibling.path), sibling.path)
        }
        let contents = try String(contentsOf: log, encoding: .utf8)
        let lines = contents.split(separator: "\n")
        XCTAssertEqual(lines.count, 1)
        let fields = try XCTUnwrap(lines.first).split(separator: "\t")
        XCTAssertEqual(fields.count, 2)
        XCTAssertNotNil(ISO8601DateFormatter().date(from: String(fields[0])))
        XCTAssertEqual(fields[1], "switch.jpg -> switch.jpg")
        try sweeper.sweep()
        XCTAssertEqual(try String(contentsOf: log, encoding: .utf8), contents)
    }

    func testCollisionsPreserveExistingFilesAndSuffixExtensions() throws {
        for name in ["capture.jpg", "capture"] {
            let first = try image(name)
            try makeSweeper().process(first)
            let second = try image(name)
            try makeSweeper().process(second)
            let third = try image(name)
            try makeSweeper().process(third)
            let folder = downloads.appendingPathComponent("Nintendo Switch App")
            let stem = "capture"
            let ext = name == "capture" ? "" : ".jpg"
            for suffix in ["", " 2", " 3"] {
                let destination = folder.appendingPathComponent("\(stem)\(suffix)\(ext)")
                XCTAssertNotNil(MetadataReader.make(at: destination))
            }
        }
        XCTAssertEqual(try String(contentsOf: log, encoding: .utf8).split(separator: "\n").count, 6)
    }

    func testDelayedMetadataCanQualifyOnNextAttempt() throws {
        let url = try image("later.jpg", agent: nil)
        let sweeper = makeSweeper()
        XCTAssertEqual(try sweeper.process(url), .retryLater)
        XCTAssertFalse(FileManager.default.fileExists(atPath: log.path))
        try setQuarantine(url, value: quarantine())
        guard case .moved = try sweeper.process(url) else { return XCTFail("Expected a move") }
    }

    func testSymlinkDestinationDoesNotMoveOutsideDownloads() throws {
        let outside = root.appendingPathComponent("outside", isDirectory: true)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: false)
        try FileManager.default.createSymbolicLink(
            at: downloads.appendingPathComponent("Nintendo Switch App"), withDestinationURL: outside
        )
        let url = try image("stay.jpg")
        XCTAssertThrowsError(try makeSweeper().process(url))
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: outside.path).isEmpty)
    }

    func testLogEscapesFilenameNewlinesIntoOnePhysicalLine() throws {
        let url = try image("capture\nline.jpg")
        try makeSweeper().process(url)
        let contents = try String(contentsOf: log, encoding: .utf8)
        XCTAssertEqual(contents.split(separator: "\n").count, 1)
        XCTAssertTrue(contents.contains("capture\\nline.jpg -> capture\\nline.jpg"))
    }

    func testLastMoveIsReadBackFromTheLog() throws {
        XCTAssertNil(MoveLogEntry.last(in: log))
        let logger = FileMoveLogger(url: log)
        try logger.recordMove(from: URL(fileURLWithPath: "/a/first.jpg"), to: URL(fileURLWithPath: "/b/first.jpg"))
        try logger.recordMove(from: URL(fileURLWithPath: "/a/x -> y.jpg"), to: URL(fileURLWithPath: "/b/x -> y 2.jpg"))
        let entry = try XCTUnwrap(MoveLogEntry.last(in: log))
        XCTAssertEqual(entry.source, "x -> y.jpg")
        XCTAssertEqual(entry.destination, "x -> y 2.jpg")
        XCTAssertLessThan(abs(entry.date.timeIntervalSinceNow), 5)
    }

    func testCutoffFallbackAndReinstallPreservationWithoutWritingPreferences() {
        let defaults = MemoryDefaults()
        let store = CutoffStore(defaults: defaults)
        XCTAssertEqual(store.effectiveCutoff(launchTime: cutoff), cutoff)
        store.storeIfAbsent(cutoff)
        store.storeIfAbsent(cutoff.addingTimeInterval(100))
        XCTAssertEqual(store.stored, cutoff)
        defaults.set("not a number", forKey: CutoffStore.key)
        XCTAssertNil(store.stored)
        defaults.set(true, forKey: CutoffStore.key)
        XCTAssertNil(store.stored)
    }

    private func makeSweeper() -> Sweeper {
        Sweeper(downloads: downloads, cutoff: cutoff, logger: FileMoveLogger(url: log))
    }

    private func quarantine(agent: String = "sharingd", seconds: Int = 1_700_000_001) -> String {
        "0081;\(String(seconds, radix: 16));\(agent);5C0F4CF0-2BE6-4D4F-A858-E36F03626A04"
    }

    @discardableResult
    private func image(_ name: String, make: String? = "Nintendo co., ltd", agent: String? = "sharingd",
                       seconds: Int = 1_700_000_001, parent: URL? = nil) throws -> URL {
        let url = (parent ?? downloads).appendingPathComponent(name)
        let context = try XCTUnwrap(CGContext(data: nil, width: 4, height: 4, bitsPerComponent: 8,
                                            bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        context.setFillColor(CGColor(red: 0.2, green: 0.5, blue: 0.8, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
        let image = try XCTUnwrap(context.makeImage())
        let destination = try XCTUnwrap(CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil))
        let properties: [CFString: Any] = make.map { [kCGImagePropertyTIFFDictionary: [kCGImagePropertyTIFFMake: $0]] } ?? [:]
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        if let agent { try setQuarantine(url, value: quarantine(agent: agent, seconds: seconds)) }
        return url
    }

    private func setQuarantine(_ url: URL, value: String) throws {
        let bytes = Data(value.utf8)
        let result = bytes.withUnsafeBytes {
            setxattr(url.path, "com.apple.quarantine", $0.baseAddress, $0.count, 0, XATTR_NOFOLLOW)
        }
        guard result == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    }
}

/// Cutoff tests never write to this Mac's defaults domains.
private final class MemoryDefaults: UserDefaults {
    private var values: [String: Any] = [:]
    override func object(forKey defaultName: String) -> Any? { values[defaultName] }
    override func set(_ value: Any?, forKey defaultName: String) { values[defaultName] = value }
}
