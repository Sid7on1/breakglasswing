import Foundation
import CoreGraphics
import BimaxComputerUseKit

struct CaptureConformanceReport: Codable, Sendable {
    var status: String
    var bundleId: String
    var pid: Int32?
    var windowId: UInt32?
    var receivedFrames: UInt64
    var completeFrames: UInt64
    var idleFrames: UInt64
    var oneShotFallback: Bool
    var imageBytes: Int?
    var width: Int?
    var height: Int?
    var latestLatencyMs: Double?
    var lastFrameStatusRaw: Int?
    var error: String?
}

private final class CaptureConformanceBox: @unchecked Sendable {
    private let lock = NSLock()
    private var report: CaptureConformanceReport?

    func set(_ report: CaptureConformanceReport) { lock.withLock { self.report = report } }
    func get() -> CaptureConformanceReport? { lock.withLock { report } }
}

enum CaptureConformance {
    static func run(bundleId: String) -> CaptureConformanceReport {
        guard #available(macOS 12.3, *) else {
            return empty(status: "unsupported", bundleId: bundleId, error: "ScreenCaptureKit requires macOS 12.3")
        }
        guard CGPreflightScreenCaptureAccess() else {
            return empty(
                status: "blocked", bundleId: bundleId,
                error: "screen_recording_denied: grant Screen Recording permission to the Bimax service host"
            )
        }
        let box = CaptureConformanceBox()
        Task.detached {
            box.set(await runAsync(bundleId: bundleId))
        }
        // The proven BimaxLivePip lifecycle runs AppKit's event loop while ScreenCaptureKit is
        // active. Blocking the service's main thread on a semaphore lets startCapture succeed but
        // prevents frame delivery entirely, so this synchronous CLI shim must keep pumping it too.
        let deadline = Date().addingTimeInterval(8)
        while box.get() == nil, Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        return box.get() ?? empty(status: "failed", bundleId: bundleId, error: "capture task returned no report")
    }

    @available(macOS 12.3, *)
    private static func runAsync(bundleId: String) async -> CaptureConformanceReport {
        do {
            let workspace = try WorkspaceInventory().snapshot(.init(includeOffscreenWindows: true))
            guard let app = workspace.apps.first(where: { $0.app.bundleId == bundleId }) else {
                return empty(status: "failed", bundleId: bundleId, error: "target application is not running")
            }
            let targetWindows = workspace.windows.filter {
                $0.window.pid == app.app.pid && $0.window.windowId > 0
                    && $0.bounds.width > 64 && $0.bounds.height > 64
            }
            guard let window = targetWindows.first(where: \.onScreen) ?? targetWindows.first else {
                return empty(status: "failed", bundleId: bundleId, pid: app.app.pid, error: "target window is unavailable")
            }

            let driver = await MainActor.run { ScreenCaptureKitStreamDriver() }
            let pool = try CaptureStreamPool(maxStreams: 1, driver: driver)
            let lease = try await pool.acquire(target: .window(
                pid: app.app.pid,
                windowId: window.window.windowId
            ))
            defer { Task { await pool.reset() } }

            let deadline = Date().timeIntervalSinceReferenceDate + 5
            var latest = CaptureStreamStats()
            while Date().timeIntervalSinceReferenceDate < deadline {
                if let stats = try await pool.stats(for: lease) {
                    latest = stats
                    if stats.completeFrames > 0, let width = stats.width, let height = stats.height,
                       width > 0, height > 0 {
                        try await pool.release(lease)
                        await pool.reset()
                        return CaptureConformanceReport(
                            status: "ran", bundleId: bundleId, pid: app.app.pid,
                            windowId: window.window.windowId,
                            receivedFrames: stats.receivedFrames,
                            completeFrames: stats.completeFrames, idleFrames: stats.idleFrames,
                            oneShotFallback: false, imageBytes: nil,
                            width: width, height: height, latestLatencyMs: stats.latestLatencyMs,
                            lastFrameStatusRaw: stats.lastFrameStatusRaw,
                            error: nil
                        )
                    }
                    if let reason = stats.stoppedReason {
                        throw CaptureConformanceError.streamStopped(reason)
                    }
                }
                try await Task.sleep(nanoseconds: 50_000_000)
            }
            try await pool.release(lease)
            await pool.reset()
            if #available(macOS 14.0, *) {
                let still = try await driver.stillImage(
                    target: .window(pid: app.app.pid, windowId: window.window.windowId),
                    request: .init(format: .png, maxDimension: 1_456, jpegQuality: 1)
                )
                return CaptureConformanceReport(
                    status: "ran", bundleId: bundleId, pid: app.app.pid,
                    windowId: window.window.windowId,
                    receivedFrames: latest.receivedFrames,
                    completeFrames: latest.completeFrames, idleFrames: latest.idleFrames,
                    oneShotFallback: true, imageBytes: still.bytes.count,
                    width: still.pixelWidth, height: still.pixelHeight,
                    latestLatencyMs: latest.latestLatencyMs,
                    lastFrameStatusRaw: latest.lastFrameStatusRaw, error: nil
                )
            }
            return CaptureConformanceReport(
                status: "failed", bundleId: bundleId, pid: app.app.pid,
                windowId: window.window.windowId,
                receivedFrames: latest.receivedFrames,
                completeFrames: latest.completeFrames, idleFrames: latest.idleFrames,
                oneShotFallback: false, imageBytes: nil,
                width: latest.width, height: latest.height,
                latestLatencyMs: latest.latestLatencyMs,
                lastFrameStatusRaw: latest.lastFrameStatusRaw,
                error: "no complete ScreenCaptureKit frame arrived within 5 seconds"
            )
        } catch {
            return empty(status: "failed", bundleId: bundleId, error: String(describing: error))
        }
    }

    private static func empty(
        status: String,
        bundleId: String,
        pid: Int32? = nil,
        error: String
    ) -> CaptureConformanceReport {
        CaptureConformanceReport(
            status: status, bundleId: bundleId, pid: pid, windowId: nil,
            receivedFrames: 0,
            completeFrames: 0, idleFrames: 0, oneShotFallback: false, imageBytes: nil,
            width: nil, height: nil,
            latestLatencyMs: nil, lastFrameStatusRaw: nil, error: error
        )
    }
}

private enum CaptureConformanceError: Error {
    case streamStopped(String)
}
