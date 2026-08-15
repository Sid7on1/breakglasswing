import AppKit
import Foundation
import BimaxCuProtocol
import BimaxComputerUseKit

/// Proves that a physical foreground action stops before delivery when the coordinator has not
/// supplied the user approval bound to that exact target. The independent value read-back makes
/// this an end-state check, not merely an assertion about an error code.
struct StopConformanceReport: Codable, Sendable {
    var status: String
    var reason: String?
    var bundleId: String
    var refusalCode: String?
    var targetValueBefore: String?
    var targetValueAfter: String?
    var targetUnchanged: Bool
    var frontmostPidBefore: Int32?
    var frontmostPidAfter: Int32?
    var foregroundPreserved: Bool
}

enum StopConformance {
    static func run(bundleId: String) -> StopConformanceReport {
        var report = StopConformanceReport(
            status: "skipped", bundleId: bundleId, targetUnchanged: false,
            foregroundPreserved: false
        )
        guard AXIsProcessTrusted() else {
            report.reason = "accessibility_not_granted"
            return report
        }
        guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first else {
            report.reason = "target_not_running"
            return report
        }

        let core = BimaxCuServiceCore()
        guard case .session(let session) = core.handle(RequestEnvelope(
            requestId: "stop-create", sessionId: "bootstrap", deadlineMs: 10_000,
            body: .sessionCreate(requestedId: "stop-conformance")
        )).body else {
            report.reason = "session_create_failed"
            return report
        }
        defer {
            _ = core.handle(RequestEnvelope(
                requestId: "stop-close", sessionId: session.sessionId,
                deadlineMs: 10_000, body: .sessionClose
            ))
        }

        func observe() -> (AXSnapshot, AXNode)? {
            guard case .workspace(let workspace) = core.handle(RequestEnvelope(
                requestId: "stop-window", sessionId: session.sessionId, deadlineMs: 10_000,
                body: .workspaceSnapshot(.init(pid: app.processIdentifier, includeOffscreenWindows: true))
            )).body else { return nil }
            let candidates = workspace.windows.filter {
                $0.window.pid == app.processIdentifier && $0.bounds.width > 64 && $0.bounds.height > 64
            }
            guard let window = candidates.first(where: \.onScreen) ?? candidates.first else { return nil }
            let response = core.handle(RequestEnvelope(
                requestId: "stop-observe", sessionId: session.sessionId, deadlineMs: 10_000,
                body: .axObserve(.init(
                    pid: app.processIdentifier, windowId: window.window.windowId,
                    windowGeneration: window.window.generation, scope: .window,
                    profile: "flash", maxElements: 500
                ))
            ))
            guard case .axSnapshot(let snapshot) = response.body,
                  let node = snapshot.nodes.first(where: {
                      $0.role == "AXTextArea"
                          && ($0.identifier == "fixture-textview" || $0.label == "fixture-textview")
                  }) else { return nil }
            return (snapshot, node)
        }

        guard let (beforeSnapshot, beforeNode) = observe(), let ref = beforeNode.elementRef else {
            report.reason = "target_not_observable"
            return report
        }
        report.status = "ran"
        report.targetValueBefore = beforeNode.value
        report.frontmostPidBefore = NSWorkspace.shared.frontmostApplication?.processIdentifier

        // Deliberately omit ForegroundApproval. The service must refuse before acquiring a lease,
        // focusing the fixture, clicking it, or posting the text.
        let response = core.handle(RequestEnvelope(
            requestId: "stop-action", sessionId: session.sessionId, deadlineMs: 10_000,
            body: .semanticAction(.init(
                element: ref, action: .typeText, value: .string("MUST-NOT-APPEAR"),
                expectedEventRevision: beforeSnapshot.eventRevision,
                deliveryPolicy: .foregroundOnce
            ))
        ))
        report.refusalCode = response.error?.code
        Thread.sleep(forTimeInterval: 0.25)
        report.frontmostPidAfter = NSWorkspace.shared.frontmostApplication?.processIdentifier
        report.foregroundPreserved = report.frontmostPidBefore == report.frontmostPidAfter
        report.targetValueAfter = observe()?.1.value
        report.targetUnchanged = report.targetValueAfter == report.targetValueBefore
        return report
    }
}
