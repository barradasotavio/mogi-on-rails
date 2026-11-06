import CoreFoundation
import Foundation

public struct CutoffStore {
    public static let domain = "io.github.barradasotavio.switch-airdrop"
    public static let key = "InstallCutoff"
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = CutoffStore.installedDefaults()) {
        self.defaults = defaults
    }

    /// Inside the installed app the domain is its own, which a suite cannot name.
    public static func installedDefaults() -> UserDefaults {
        Bundle.main.bundleIdentifier == domain ? .standard : UserDefaults(suiteName: domain) ?? .standard
    }

    public var stored: Date? {
        guard let number = defaults.object(forKey: Self.key) as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite else { return nil }
        return Date(timeIntervalSince1970: number.doubleValue)
    }

    /// Reinstallation preserves the first installation's boundary.
    public func storeIfAbsent(_ date: Date) {
        if defaults.object(forKey: Self.key) == nil {
            defaults.set(date.timeIntervalSince1970, forKey: Self.key)
        }
    }

    public func effectiveCutoff(launchTime: Date) -> Date {
        stored ?? launchTime
    }
}
