import Darwin
import Foundation
import ImageIO

/// lstat deliberately excludes symlinks. Also used to wait for a quiet write
/// interval in the watcher, even when a partial image already has a Make tag.
public struct FileSnapshot: Equatable {
    public let device: dev_t
    public let inode: ino_t
    public let size: off_t
    public let modifiedSeconds: Int
    public let modifiedNanoseconds: Int
    public let changedSeconds: Int
    public let changedNanoseconds: Int

    public init?(url: URL) {
        var info = stat()
        guard url.withUnsafeFileSystemRepresentation({ path in
            path.map { lstat($0, &info) } ?? -1
        }) == 0, (info.st_mode & S_IFMT) == S_IFREG else { return nil }
        device = info.st_dev
        inode = info.st_ino
        size = info.st_size
        modifiedSeconds = info.st_mtimespec.tv_sec
        modifiedNanoseconds = info.st_mtimespec.tv_nsec
        changedSeconds = info.st_ctimespec.tv_sec
        changedNanoseconds = info.st_ctimespec.tv_nsec
    }
}

public enum MetadataReader {
    public static func quarantine(at url: URL) -> String? {
        url.withUnsafeFileSystemRepresentation { path in
            guard let path else { return nil }
            let name = "com.apple.quarantine"
            let length = getxattr(path, name, nil, 0, 0, XATTR_NOFOLLOW)
            guard length > 0 else { return nil }
            var bytes = [UInt8](repeating: 0, count: length)
            let count = bytes.withUnsafeMutableBytes {
                getxattr(path, name, $0.baseAddress, $0.count, 0, XATTR_NOFOLLOW)
            }
            guard count > 0 else { return nil }
            return String(bytes: bytes.prefix(count), encoding: .utf8)
        }
    }

    public static func make(at url: URL) -> String? {
        guard let source = CGImageSourceCreateWithURL(
            url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary
        ), CGImageSourceGetStatus(source) == .statusComplete,
           let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
           let tiff = properties[kCGImagePropertyTIFFDictionary] as? [CFString: Any]
        else { return nil }
        return tiff[kCGImagePropertyTIFFMake] as? String
    }
}
