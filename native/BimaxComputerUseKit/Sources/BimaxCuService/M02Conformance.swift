import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import BimaxCuProtocol
import BimaxComputerUseKit

/// Local end-state grader for M02's background semantic route.
///
/// The target and bystander are purpose-built bundles. The target persists two reminder rows; the
/// bystander records global synthetic "user" keystrokes. A run is valid only if the target changes
/// exactly once, the unrelated row survives, the bystander remains frontmost and receives the full
/// sequence, and a terminated/reopened target restores the new value from disk.
enum M02Conformance {
    struct Check: Codable {
        var name: String
        var passed: Bool
        var detail: String
    }

    struct Report: Codable {
        var status: String
        var reason: String?
        var targetBundleId: String
        var bystanderBundleId: String
        var deliveryPath: String?
        var frontmostPidBefore: Int32?
        var frontmostPidAfter: Int32?
        var actionCompletedAtMs: Int64?
        var freshObservationAtMs: Int64?
        var checks: [Check] = []
        var passed: Int = 0
        var failed: Int = 0
    }

    private struct Observation {
        var snapshot: AXSnapshot
        var mom: AXNode
        var dentist: AXNode
        var momCount: Int
    }

    static func run(
        targetBundleId: String,
        bystanderBundleId: String,
        reminderStatePath: String,
        typingStatePath: String
    ) -> Report {
        var report = Report(
            status: "skipped", targetBundleId: targetBundleId,
            bystanderBundleId: bystanderBundleId
        )
        guard AXIsProcessTrusted() else {
            report.reason = "accessibility_not_granted"
            return report
        }
        guard let target = NSRunningApplication.runningApplications(withBundleIdentifier: targetBundleId).first,
              let targetURL = target.bundleURL else {
            report.reason = "target_not_running"
            return report
        }
        guard let bystander = NSRunningApplication.runningApplications(withBundleIdentifier: bystanderBundleId).first else {
            report.reason = "bystander_not_running"
            return report
        }
        if #available(macOS 14.0, *) { bystander.activate() }
        else { bystander.activate(options: [.activateIgnoringOtherApps]) }
        guard waitUntil(timeout: 3.0, { WorkspaceInventory.frontmostPid() == bystander.processIdentifier }) else {
            report.reason = "bystander_not_frontmost"
            return report
        }

        let core = BimaxCuServiceCore()
        guard case .session(let session) = core.handle(RequestEnvelope(
            requestId: "m02-create", sessionId: "bootstrap", deadlineMs: 10_000,
            body: .sessionCreate(requestedId: "m02-conformance")
        )).body else {
            report.reason = "session_create_failed"
            return report
        }
        defer {
            _ = core.handle(RequestEnvelope(
                requestId: "m02-close", sessionId: session.sessionId,
                deadlineMs: 10_000, body: .sessionClose
            ))
        }

        guard let before = observe(core: core, sessionId: session.sessionId, pid: target.processIdentifier) else {
            report.reason = "target_observation_failed"
            return report
        }
        let beforeMom = before.mom.value
        let beforeDentist = before.dentist.value
        let expectedTyping = "M02-before|M02-after"
        guard postUserText("M02-before|"),
              waitUntil(timeout: 2.0, { readText(typingStatePath) == "M02-before|" }) else {
            report.reason = "bystander_prefix_not_recorded"
            return report
        }

        report.status = "ran"
        report.frontmostPidBefore = WorkspaceInventory.frontmostPid()
        let response = core.handle(RequestEnvelope(
            requestId: "m02-set-time", sessionId: session.sessionId, deadlineMs: 10_000,
            body: .semanticAction(.init(
                element: before.mom.elementRef!, action: .setValue, value: .string("7:30 PM"),
                expectedEventRevision: before.snapshot.eventRevision,
                deliveryPolicy: .backgroundOnly,
                evidence: .init(
                    tier: .semantic,
                    postcondition: .init(expectedValue: "7:30 PM", valueMustChange: true)
                )
            ))
        ))
        let receipt: SemanticActionReceipt?
        if case .semanticActionReceipt(let value) = response.body { receipt = value }
        else { receipt = nil }
        report.deliveryPath = receipt?.deliveryPath?.rawValue
        report.actionCompletedAtMs = receipt?.completedAtMs
        report.frontmostPidAfter = WorkspaceInventory.frontmostPid()

        let suffixPosted = postUserText("M02-after")
        let typingComplete = suffixPosted && waitUntil(timeout: 2.0) {
            readText(typingStatePath) == expectedTyping
        }
        let persisted = waitUntil(timeout: 2.0) {
            reminderState(reminderStatePath)?["Mom demo"] == "7:30 PM"
        }
        let after = observe(core: core, sessionId: session.sessionId, pid: target.processIdentifier)
        report.freshObservationAtMs = after?.snapshot.capturedAtMs

        let terminated = target.terminate() && waitUntil(timeout: 4.0) {
            NSRunningApplication.runningApplications(withBundleIdentifier: targetBundleId).isEmpty
        }
        let reopened = terminated && relaunch(
            targetURL, arguments: ["--m02-fixture", "--m02-state", reminderStatePath]
        )
        let reopenedApp = reopened ? waitForApplication(targetBundleId, timeout: 5.0) : nil
        var reopenedObservation: Observation?
        if let reopenedApp {
            _ = waitUntil(timeout: 5.0) {
                reopenedObservation = observe(
                    core: core, sessionId: session.sessionId, pid: reopenedApp.processIdentifier
                )
                return reopenedObservation != nil
            }
        }
        let persistedState = reminderState(reminderStatePath)

        report.checks = [
            .init(name: "unique target", passed: before.momCount == 1,
                  detail: "Mom demo time controls observed: \(before.momCount)"),
            .init(name: "semantic background delivery", passed: receipt?.deliveryPath == .axAttribute,
                  detail: receipt.map { "\($0.deliveryPolicy.rawValue) via \($0.deliveryPath?.rawValue ?? "none")" }
                    ?? (response.error?.code ?? "no receipt")),
            .init(name: "value changed", passed: beforeMom != "7:30 PM" && after?.mom.value == "7:30 PM",
                  detail: "\(beforeMom ?? "nil") -> \(after?.mom.value ?? "nil")"),
            .init(name: "other row unchanged", passed: after?.dentist.value == beforeDentist,
                  detail: "Dentist remained \(after?.dentist.value ?? "nil")"),
            .init(name: "foreground preserved",
                  passed: report.frontmostPidBefore == bystander.processIdentifier
                    && report.frontmostPidAfter == bystander.processIdentifier,
                  detail: "\(String(describing: report.frontmostPidBefore)) -> \(String(describing: report.frontmostPidAfter))"),
            .init(name: "bystander keystrokes preserved", passed: typingComplete,
                  detail: "recorded \(readText(typingStatePath) ?? "nil")"),
            .init(name: "state persisted", passed: persisted && persistedState?["Mom demo"] == "7:30 PM",
                  detail: "stored \(persistedState?["Mom demo"] ?? "nil")"),
            .init(name: "fresh post-action observation",
                  passed: (after?.snapshot.capturedAtMs ?? 0) >= (receipt?.completedAtMs ?? Int64.max),
                  detail: "action \(receipt?.completedAtMs ?? -1), observation \(after?.snapshot.capturedAtMs ?? -1)"),
            .init(name: "reopen restored exact state",
                  passed: reopenedObservation?.mom.value == "7:30 PM"
                    && reopenedObservation?.dentist.value == beforeDentist
                    && reopenedObservation?.momCount == 1,
                  detail: "Mom demo \(reopenedObservation?.mom.value ?? "nil"), Dentist \(reopenedObservation?.dentist.value ?? "nil")"),
        ]
        report.passed = report.checks.filter(\.passed).count
        report.failed = report.checks.count - report.passed
        return report
    }

    private static func observe(
        core: BimaxCuServiceCore, sessionId: String, pid: Int32
    ) -> Observation? {
        guard case .workspace(let workspace) = core.handle(RequestEnvelope(
            requestId: "m02-workspace-\(UUID().uuidString)", sessionId: sessionId,
            deadlineMs: 10_000, body: .workspaceSnapshot(.init(pid: pid, includeOffscreenWindows: true))
        )).body else { return nil }
        let windows = workspace.windows.filter { $0.window.pid == pid && $0.bounds.width > 64 }
        guard let window = windows.first(where: \.onScreen) ?? windows.first else { return nil }
        let response = core.handle(RequestEnvelope(
            requestId: "m02-observe-\(UUID().uuidString)", sessionId: sessionId, deadlineMs: 10_000,
            body: .axObserve(.init(
                pid: pid, windowId: window.window.windowId,
                windowGeneration: window.window.generation, scope: .window,
                profile: "balanced", maxElements: 500
            ))
        ))
        guard case .axSnapshot(let snapshot) = response.body else { return nil }
        let moms = snapshot.nodes.filter { $0.identifier == "fixture-reminder-mom-demo-time" }
        guard let mom = moms.first,
              let dentist = snapshot.nodes.first(where: { $0.identifier == "fixture-reminder-dentist-time" }),
              mom.elementRef != nil else { return nil }
        return Observation(snapshot: snapshot, mom: mom, dentist: dentist, momCount: moms.count)
    }

    private static func postUserText(_ text: String) -> Bool {
        guard let source = CGEventSource(stateID: .privateState) else { return false }
        let units = Array(text.utf16)
        for start in stride(from: 0, to: units.count, by: 20) {
            let chunk = Array(units[start..<min(start + 20, units.count)])
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else { return false }
            var units = chunk
            down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
            up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
        }
        return true
    }

    private static func reminderState(_ path: String) -> [String: String]? {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: String]
        else { return nil }
        return value
    }

    private static func readText(_ path: String) -> String? {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func relaunch(_ url: URL, arguments: [String]) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-g", url.path, "--args"] + arguments
        do { try process.run(); process.waitUntilExit(); return process.terminationStatus == 0 }
        catch { return false }
    }

    private static func waitForApplication(_ bundleId: String, timeout: TimeInterval) -> NSRunningApplication? {
        var found: NSRunningApplication?
        _ = waitUntil(timeout: timeout) {
            found = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first
            return found != nil
        }
        return found
    }

    private static func waitUntil(timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if condition() { return true }
            Thread.sleep(forTimeInterval: 0.05)
        } while Date() < deadline
        return condition()
    }
}
