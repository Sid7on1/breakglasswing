// Behavior derived from MacOS-Use `macos_use/ax/core.py` (MIT), pinned at
// c88574c0a70534a21e9490e2118f1fce04e16904: `GetApplicationPathByName`,
// `GetApplicationPathByBundleID`, and `LaunchApplication`.
//
// Deliberate divergences, recorded in `docs/BIMAX_CU_PORTING_LEDGER.md` under `MU-012`:
//
// - upstream shells out to `open -a <name>` and falls back to the deprecated
//   `NSWorkspace.launchApplication(_:)`. Both activate the target, and a subprocess is exactly the
//   arbitrary-execution path `docs/BIMAX_CU_MASTER_REFACTOR_PLAN` §10.11 keeps out of this service.
//   Bimax-Cu uses `NSWorkspace.openApplication(at:configuration:)` with `activates = false`;
// - upstream's lookup accepts a full filesystem path, so its launcher can start any bundle on
//   disk. `AppLookup` has no path case and this file refuses path-shaped lookups, so the service
//   can only start a Launch Services-registered application named by bundle id or display name;
// - upstream returns a bare `bool`. Bimax-Cu returns a receipt carrying the frontmost PID measured
//   before and after the call, because every activation route in this kit has at some point
//   reported success while changing nothing.

import AppKit
import Foundation
import BimaxCuProtocol

public enum AppWorkspaceError: Error, Equatable {
    case invalidLookup(String)
    case notFound
    case launchFailed(String)
    case launchTimedOut
}

/// Launch Services seam. The live implementation is the only thing that touches AppKit, so the
/// launch policy above it is testable without starting real applications.
public protocol LaunchServicesProviding: Sendable {
    func urlForBundleId(_ bundleId: String) -> URL?
    func urlForName(_ name: String) -> URL?
    func bundleMetadata(at url: URL) -> (bundleId: String?, displayName: String?)
    func runningInstances(bundleId: String) -> [AppRef]
    func frontmostPid() -> Int32?
    /// Open a resolved application bundle without activating it. Returns the running instance.
    func openWithoutActivation(_ url: URL, timeoutMs: Int) throws -> AppRef
    func finishedLaunching(pid: Int32) -> Bool
}

public protocol AppWorkspaceOperating: Sendable {
    func resolve(_ request: AppResolveRequest) throws -> ResolvedApplication
    func launch(_ request: AppLaunchRequest) throws -> AppLaunchReceipt
}

public final class AppWorkspace: AppWorkspaceOperating, @unchecked Sendable {
    public static let maxLookupLength = 256
    public static let maxReadinessTimeoutMs = 10_000

    private let services: any LaunchServicesProviding
    private let sleeper: @Sendable (UInt32) -> Void

    public init(
        services: any LaunchServicesProviding = SystemLaunchServices(),
        sleeper: @escaping @Sendable (UInt32) -> Void = { usleep($0) }
    ) {
        self.services = services
        self.sleeper = sleeper
    }

    public func resolve(_ request: AppResolveRequest) throws -> ResolvedApplication {
        try Self.validate(request.lookup)
        guard let url = locate(request.lookup) else {
            return ResolvedApplication(lookup: request.lookup, resolved: false)
        }
        let metadata = services.bundleMetadata(at: url)
        let bundleId = metadata.bundleId
        return ResolvedApplication(
            lookup: request.lookup,
            resolved: true,
            bundlePath: url.path,
            bundleId: bundleId,
            displayName: metadata.displayName,
            running: bundleId.map { services.runningInstances(bundleId: $0) } ?? []
        )
    }

    public func launch(_ request: AppLaunchRequest) throws -> AppLaunchReceipt {
        try Self.validate(request.lookup)
        guard (0...Self.maxReadinessTimeoutMs).contains(request.readinessTimeoutMs) else {
            throw AppWorkspaceError.invalidLookup("readinessTimeoutMs must be between 0 and \(Self.maxReadinessTimeoutMs)")
        }
        guard let url = locate(request.lookup) else { throw AppWorkspaceError.notFound }
        let metadata = services.bundleMetadata(at: url)
        let startedAt = Date()
        let frontmostBefore = services.frontmostPid()

        // Opening an application that is already running raises it. A background launch must never
        // do that, so an existing instance ends the request instead of being "launched" again.
        if let bundleId = metadata.bundleId, let existing = services.runningInstances(bundleId: bundleId).first {
            return AppLaunchReceipt(
                outcome: .alreadyRunning,
                app: existing,
                bundlePath: url.path,
                bundleId: bundleId,
                requestedActivation: false,
                frontmostPidBefore: frontmostBefore,
                frontmostPidAfter: services.frontmostPid(),
                finishedLaunching: services.finishedLaunching(pid: existing.pid),
                durationMs: Self.elapsedMs(since: startedAt)
            )
        }

        let launched = try services.openWithoutActivation(url, timeoutMs: max(1_000, request.readinessTimeoutMs))
        let ready = waitForReadiness(pid: launched.pid, timeoutMs: request.readinessTimeoutMs)
        return AppLaunchReceipt(
            outcome: .launched,
            app: launched,
            bundlePath: url.path,
            bundleId: metadata.bundleId ?? launched.bundleId,
            requestedActivation: false,
            frontmostPidBefore: frontmostBefore,
            frontmostPidAfter: services.frontmostPid(),
            finishedLaunching: ready,
            durationMs: Self.elapsedMs(since: startedAt)
        )
    }

    private func locate(_ lookup: AppLookup) -> URL? {
        switch lookup {
        case .bundleId(let value): return services.urlForBundleId(value)
        case .name(let value): return services.urlForName(value)
        }
    }

    /// Bounded poll rather than a fixed sleep: a slow application reports its own readiness.
    private func waitForReadiness(pid: Int32, timeoutMs: Int) -> Bool {
        if services.finishedLaunching(pid: pid) { return true }
        guard timeoutMs > 0 else { return false }
        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1_000)
        while Date() < deadline {
            sleeper(50_000)
            if services.finishedLaunching(pid: pid) { return true }
        }
        return false
    }

    /// A lookup is a Launch Services key, never a path and never a shell word.
    static func validate(_ lookup: AppLookup) throws {
        let value = lookup.value
        guard !value.isEmpty, value.count <= maxLookupLength else {
            throw AppWorkspaceError.invalidLookup("app lookup must be 1-\(maxLookupLength) characters")
        }
        guard !value.contains("\0") else { throw AppWorkspaceError.invalidLookup("app lookup contains a NUL") }
        // A path-shaped lookup would let a caller name a bundle Launch Services never registered.
        guard !value.contains("/"), !value.contains("\\"), !value.hasPrefix("."), !value.contains("..") else {
            throw AppWorkspaceError.invalidLookup("app lookup must not be a filesystem path")
        }
        guard value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else {
            throw AppWorkspaceError.invalidLookup("app lookup contains control characters")
        }
        if case .bundleId(let bundleId) = lookup {
            let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-")
            guard bundleId.unicodeScalars.allSatisfy({ allowed.contains($0) }) else {
                throw AppWorkspaceError.invalidLookup("bundle identifiers accept only letters, digits, dots, and hyphens")
            }
        }
    }

    private static func elapsedMs(since start: Date) -> Int {
        max(0, Int(Date().timeIntervalSince(start) * 1_000))
    }
}

/// The live AppKit implementation. Everything policy-shaped lives in `AppWorkspace`.
public final class SystemLaunchServices: LaunchServicesProviding, @unchecked Sendable {
    public init() {}

    public func urlForBundleId(_ bundleId: String) -> URL? {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId)
    }

    public func urlForName(_ name: String) -> URL? {
        // `fullPath(forApplication:)` is the name-based Launch Services lookup MacOS-Use uses. The
        // caller-supplied value is already known not to be a path, so this cannot be steered at an
        // arbitrary bundle.
        guard let path = NSWorkspace.shared.fullPath(forApplication: name) else { return nil }
        return URL(fileURLWithPath: path)
    }

    public func bundleMetadata(at url: URL) -> (bundleId: String?, displayName: String?) {
        guard let bundle = Bundle(url: url) else { return (nil, nil) }
        let name = (bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
            ?? (bundle.object(forInfoDictionaryKey: "CFBundleName") as? String)
            ?? url.deletingPathExtension().lastPathComponent
        return (bundle.bundleIdentifier, name)
    }

    public func runningInstances(bundleId: String) -> [AppRef] {
        NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
            .compactMap { Self.appRef($0) }
    }

    public func frontmostPid() -> Int32? { WorkspaceInventory.frontmostPid() }

    public func openWithoutActivation(_ url: URL, timeoutMs: Int) throws -> AppRef {
        let configuration = NSWorkspace.OpenConfiguration()
        // The whole point of this operation: start the process without touching the human's
        // foreground, without editing their recents, and without a second instance.
        configuration.activates = false
        configuration.addsToRecentItems = false
        configuration.createsNewApplicationInstance = false
        configuration.promptsUserIfNeeded = false

        let box = LaunchResultBox()
        let semaphore = DispatchSemaphore(value: 0)
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { app, error in
            box.set(app: app.flatMap { Self.appRef($0) }, error: error)
            semaphore.signal()
        }
        guard semaphore.wait(timeout: .now() + .milliseconds(timeoutMs)) == .success else {
            throw AppWorkspaceError.launchTimedOut
        }
        if let error = box.error { throw AppWorkspaceError.launchFailed(Self.redact(error)) }
        guard let app = box.app else { throw AppWorkspaceError.launchFailed("launch reported no application") }
        return app
    }

    public func finishedLaunching(pid: Int32) -> Bool {
        NSRunningApplication(processIdentifier: pid)?.isFinishedLaunching ?? false
    }

    private static func appRef(_ app: NSRunningApplication) -> AppRef? {
        let pid = app.processIdentifier
        guard pid > 0 else { return nil }
        let launchedAtMs = app.launchDate.map { Int64($0.timeIntervalSince1970 * 1_000) }
        return AppRef(
            bundleId: app.bundleIdentifier,
            pid: pid,
            launchId: "\(pid):\(launchedAtMs.map(String.init) ?? "unknown")",
            displayName: app.localizedName
        )
    }

    /// Launch Services errors can carry a full bundle path. Receipts stay content-free.
    private static func redact(_ error: Error) -> String {
        let code = (error as NSError).code
        return "launch services error \(code)"
    }

    private final class LaunchResultBox: @unchecked Sendable {
        private let lock = NSLock()
        private var storedApp: AppRef?
        private var storedError: Error?

        var app: AppRef? { lock.withLock { storedApp } }
        var error: Error? { lock.withLock { storedError } }

        func set(app: AppRef?, error: Error?) {
            lock.withLock {
                storedApp = app
                storedError = error
            }
        }
    }
}
