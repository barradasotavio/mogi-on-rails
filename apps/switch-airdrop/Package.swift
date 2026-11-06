// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SwitchAirdrop",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "SwitchAirdropCore", targets: ["SwitchAirdropCore"]),
        .executable(name: "SwitchAirdrop", targets: ["SwitchAirdrop"]),
    ],
    targets: [
        .target(name: "SwitchAirdropCore"),
        .executableTarget(name: "SwitchAirdrop", dependencies: ["SwitchAirdropCore"]),
        .testTarget(name: "SwitchAirdropCoreTests", dependencies: ["SwitchAirdropCore"]),
    ]
)
