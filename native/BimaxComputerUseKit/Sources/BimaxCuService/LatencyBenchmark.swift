import AppKit
import ApplicationServices
import Foundation
import BimaxCuProtocol
import BimaxComputerUseKit

/// Warm-path latency measurement against the §24.2 runtime budgets in the master refactor plan.
///
/// Read-only: it observes an already-running application and never mutates, launches, activates, or
/// types. Budgets are asserted, not merely printed, so a regression fails the run.
enum LatencyBenchmark {
    struct Measurement: Codable {
        var operation: String
        var samples: Int
        var p50Ms: Double
        var p95Ms: Double
        var budgetP50Ms: Double
        var budgetP95Ms: Double
        var withinBudget: Bool
        var nodeCount: Int?
    }

    struct Report: Codable {
        var status: String
        var reason: String?
        var bundleId: String?
        var pid: Int32?
        var measurements: [Measurement] = []
        var withinBudget: Bool = false
    }

    static func run(bundleId: String, iterations: Int) -> Report {
        var report = Report(status: "skipped", bundleId: bundleId)
        guard AXIsProcessTrusted() else {
            report.reason = "accessibility_not_granted"
            return report
        }
        guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first else {
            report.reason = "target_not_running"
            return report
        }
        let pid = app.processIdentifier
        report.pid = pid

        let core = BimaxCuServiceCore()
        guard case .session(let session) = core.handle(RequestEnvelope(
            requestId: "bench-create", sessionId: "bootstrap", deadlineMs: 10_000,
            body: .sessionCreate(requestedId: "latency")
        )).body else {
            report.reason = "session_create_failed"
            return report
        }
        let sessionId = session.sessionId

        guard case .workspace(let workspace) = core.handle(RequestEnvelope(
            requestId: "bench-workspace", sessionId: sessionId, deadlineMs: 10_000,
            body: .workspaceSnapshot(.init(pid: pid, includeOffscreenWindows: true))
        )).body else {
            report.reason = "workspace_snapshot_failed"
            return report
        }
        let candidates = workspace.windows.filter {
            $0.window.pid == pid && $0.bounds.width > 64 && $0.bounds.height > 64
        }
        guard let window = candidates.first(where: { $0.onScreen }) ?? candidates.first else {
            report.reason = "no_target_window"
            return report
        }

        func observe(since: String?) -> (AXSnapshot?, Double) {
            let started = DispatchTime.now().uptimeNanoseconds
            let response = core.handle(RequestEnvelope(
                requestId: "bench-observe", sessionId: sessionId, deadlineMs: 10_000,
                body: .axObserve(.init(
                    pid: pid, windowId: window.window.windowId,
                    windowGeneration: window.window.generation, scope: .window,
                    profile: "balanced", maxElements: 500, maxDurationMs: 5_000,
                    sinceSnapshotId: since
                ))
            ))
            let elapsed = Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000
            guard case .axSnapshot(let snapshot) = response.body else { return (nil, elapsed) }
            return (snapshot, elapsed)
        }

        // Warm the AX connection and the observer registration before measuring anything.
        for _ in 0..<3 { _ = observe(since: nil) }

        var fullSamples: [Double] = []
        var diffSamples: [Double] = []
        var nodeCount: Int?
        var previous: String?
        for _ in 0..<max(1, iterations) {
            let (snapshot, elapsed) = observe(since: nil)
            guard let snapshot else { continue }
            fullSamples.append(elapsed)
            nodeCount = snapshot.nodes.count
            // Only a retained, authoritative snapshot can be a diff base.
            previous = snapshot.changedDuringCapture || snapshot.partial || snapshot.truncated
                ? nil : snapshot.snapshotId
            guard let base = previous else { continue }
            let (diff, diffElapsed) = observe(since: base)
            if diff != nil { diffSamples.append(diffElapsed) }
        }
        guard !fullSamples.isEmpty else {
            report.reason = "no_successful_observations"
            return report
        }

        report.status = "ran"
        report.measurements = [
            measurement(
                operation: "full_pruned_ax_snapshot", samples: fullSamples,
                budgetP50: 180, budgetP95: 450, nodeCount: nodeCount
            ),
        ]
        if !diffSamples.isEmpty {
            report.measurements.append(measurement(
                operation: "warm_ax_diff_no_image", samples: diffSamples,
                budgetP50: 80, budgetP95: 200, nodeCount: nodeCount
            ))
        }
        report.withinBudget = report.measurements.allSatisfy(\.withinBudget)
        _ = core.handle(RequestEnvelope(
            requestId: "bench-close", sessionId: sessionId, deadlineMs: 10_000, body: .sessionClose
        ))
        return report
    }

    private static func measurement(
        operation: String,
        samples: [Double],
        budgetP50: Double,
        budgetP95: Double,
        nodeCount: Int?
    ) -> Measurement {
        let p50 = percentile(samples, 0.50)
        let p95 = percentile(samples, 0.95)
        return Measurement(
            operation: operation, samples: samples.count,
            p50Ms: rounded(p50), p95Ms: rounded(p95),
            budgetP50Ms: budgetP50, budgetP95Ms: budgetP95,
            withinBudget: p50 <= budgetP50 && p95 <= budgetP95,
            nodeCount: nodeCount
        )
    }

    /// Nearest-rank percentile. With small sample counts this is honest about being coarse rather
    /// than interpolating a precision the sample size does not support.
    static func percentile(_ samples: [Double], _ fraction: Double) -> Double {
        guard !samples.isEmpty else { return 0 }
        let sorted = samples.sorted()
        let rank = Int((fraction * Double(sorted.count)).rounded(.up))
        return sorted[min(max(rank - 1, 0), sorted.count - 1)]
    }

    private static func rounded(_ value: Double) -> Double { (value * 100).rounded() / 100 }
}
