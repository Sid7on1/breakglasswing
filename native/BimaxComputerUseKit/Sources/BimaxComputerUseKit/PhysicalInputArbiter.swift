import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import BimaxCuProtocol

/// How a keyboard or mouse event reaches an application. The two differ in exactly the property
/// that matters — whether the recipient is named or inferred — so they are gated differently.
public enum PhysicalInputMechanism: String, Codable, Equatable, Sendable, CaseIterable {
    /// `CGEvent.postToPid`. The recipient process is named, so there is no window-server
    /// arbitration to lose and no way for the event to land in the human's foreground application.
    /// It does not require, and does not take, the foreground. Measured working on macOS 15 with
    /// the target in the background and another application frontmost.
    case targetedProcess = "targeted_process"
    /// `CGEvent.post(tap:)`. The window server delivers to whatever is frontmost, so the recipient
    /// is inferred from focus rather than named — the whole reason the frontmost and quiet-period
    /// gates exist. Implemented only behind an exact-PID foreground lease.
    case globalStream = "global_stream"

    /// Whether the mechanism competes with the person for the physical input device.
    var sharesInputDeviceWithHuman: Bool { self == .globalStream }
    /// Whether delivery depends on which application currently has focus.
    var dependsOnForeground: Bool { self == .globalStream }
}

/// Why a physical event may not be posted. Every refusal is a specific, checkable condition; there
/// is no general "unsafe" bucket, because a gate nobody can reason about is not a gate.
public enum PhysicalInputRefusal: String, Codable, Equatable, Sendable, CaseIterable {
    /// The requested mechanism is not implemented. Present for `targeted_process` today.
    case notImplemented = "physical_input_not_implemented"
    /// A background delivery policy can never post physical input, whatever else is true.
    case policyForbids = "physical_input_policy_forbids"
    /// Physical events go wherever the window server sends them, which is the frontmost
    /// application. Posting without a held lease is posting at whatever the human is using.
    case focusLeaseRequired = "physical_input_requires_focus_lease"
    /// The intended recipient is not the application that would actually receive the event.
    case recipientNotFrontmost = "physical_recipient_not_frontmost"
    /// The target application has no focused window, so keyboard input would land nowhere useful.
    ///
    /// This deliberately does not claim the *right* window is focused. AX publishes no CGWindowID,
    /// so correlating a focused AX window to the targeted `windowId` is unsolved in this kit;
    /// asserting a match would be inventing evidence. What is checkable is whether the application
    /// has a focused window at all.
    case recipientHasNoFocusedWindow = "physical_recipient_has_no_focused_window"
    /// The human is using the machine right now. They win, always.
    case humanActive = "physical_input_human_active"
}

/// What was actually observed about the recipient at decision time. Kept on the decision so a
/// refusal can be explained without re-deriving it, and so an allow can be audited.
public struct RecipientProof: Codable, Equatable, Sendable {
    public var targetPid: Int32
    public var targetWindowId: UInt32?
    public var frontmostPid: Int32?
    public var targetIsFrontmost: Bool
    /// Whether the application has a focused window at all. nil when it could not be read.
    /// Not a claim that the *targeted* window is the focused one — see `recipientHasNoFocusedWindow`.
    public var targetHasFocusedWindow: Bool?
    public var checkedAtMs: Int64

    public init(
        targetPid: Int32,
        targetWindowId: UInt32? = nil,
        frontmostPid: Int32? = nil,
        targetIsFrontmost: Bool,
        targetHasFocusedWindow: Bool? = nil,
        checkedAtMs: Int64
    ) {
        self.targetPid = targetPid
        self.targetWindowId = targetWindowId
        self.frontmostPid = frontmostPid
        self.targetIsFrontmost = targetIsFrontmost
        self.targetHasFocusedWindow = targetHasFocusedWindow
        self.checkedAtMs = checkedAtMs
    }
}

public struct PhysicalInputDecision: Codable, Equatable, Sendable {
    public var allowed: Bool
    public var refusals: [PhysicalInputRefusal]
    public var proof: RecipientProof
    /// Seconds since the last human keyboard or mouse event. nil when it could not be read, which
    /// is treated as "the human may be active", never as "the machine is idle".
    public var secondsSinceHumanInput: Double?

    public init(
        allowed: Bool,
        refusals: [PhysicalInputRefusal],
        proof: RecipientProof,
        secondsSinceHumanInput: Double?
    ) {
        self.allowed = allowed
        self.refusals = refusals
        self.proof = proof
        self.secondsSinceHumanInput = secondsSinceHumanInput
    }
}

/// How recently the person at the keyboard did something.
public protocol HumanInputActivityReporting: Sendable {
    /// nil when the answer is unavailable. Callers must treat nil as "recently", not "never".
    func secondsSinceLastInput() -> Double?
}

public struct SystemHumanInputActivity: HumanInputActivityReporting {
    public init() {}

    /// A timing query, not an event tap: this needs no Input Monitoring grant.
    ///
    /// It counts every event in the session, including global events this process posts. The
    /// implemented process-targeted path does not consult this quiet-period gate. Any future global
    /// poster must exclude its own source or it will read Bimax as the human and deadlock itself.
    public func secondsSinceLastInput() -> Double? {
        let seconds = CGEventSource.secondsSinceLastEventType(
            .combinedSessionState, eventType: .init(rawValue: ~0)!
        )
        return seconds.isFinite && seconds >= 0 ? seconds : nil
    }
}

/// Decides whether a physical event may be posted.
///
/// Global-stream Unicode posting is implemented behind this arbiter. Process-targeted posting is
/// deliberately not advertised because current macOS releases can acknowledge it without changing
/// the target.
///
/// The gate is not theoretical. Phase 4 slice 1 established that this process cannot make a target
/// frontmost, and a global-stream event goes to whatever *is* frontmost. That is precisely the
/// wrong-target failure this phase's gate requires to stay at zero, and `recipientNotFrontmost`
/// refuses it. `postToPid` avoids that inference by naming the recipient.
public final class PhysicalInputArbiter: @unchecked Sendable {
    /// Which mechanisms this build can actually post through. `global_stream` is implemented and
    /// verified against the fixture for Unicode typing behind an exact-PID focus lease.
    public let implementedMechanisms: Set<PhysicalInputMechanism>

    public func implemented(_ mechanism: PhysicalInputMechanism) -> Bool {
        implementedMechanisms.contains(mechanism)
    }
    /// How quiet the machine must be before Bimax may take the input device.
    public let humanQuietPeriodSeconds: Double
    private let humanActivity: any HumanInputActivityReporting
    private let frontmost: @Sendable () -> Int32?
    private let clock: @Sendable () -> Int64
    /// Whether the application currently has a focused window. Injectable so the gate is testable
    /// without a live Accessibility server.
    private let focusedWindowProbe: (@Sendable (Int32) -> Bool?)?

    public init(
        implementedMechanisms: Set<PhysicalInputMechanism> = [.globalStream],
        humanQuietPeriodSeconds: Double = 1.0,
        humanActivity: any HumanInputActivityReporting = SystemHumanInputActivity(),
        frontmost: @escaping @Sendable () -> Int32? = { WorkspaceInventory.frontmostPid() },
        clock: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1_000) },
        focusedWindowProbe: (@Sendable (Int32) -> Bool?)? = nil
    ) {
        self.implementedMechanisms = implementedMechanisms
        self.humanQuietPeriodSeconds = humanQuietPeriodSeconds
        self.humanActivity = humanActivity
        self.frontmost = frontmost
        self.clock = clock
        self.focusedWindowProbe = focusedWindowProbe
    }

    /// Every condition is evaluated, not short-circuited: a caller that fixes one refusal should
    /// see the rest rather than discovering them one round-trip at a time.
    public func decide(
        mechanism: PhysicalInputMechanism,
        policy: SemanticDeliveryPolicy,
        targetPid: Int32,
        targetWindowId: UInt32?,
        holdsFocusLease: Bool
    ) -> PhysicalInputDecision {
        let front = frontmost()
        let proof = RecipientProof(
            targetPid: targetPid,
            targetWindowId: targetWindowId,
            frontmostPid: front,
            targetIsFrontmost: front == targetPid,
            targetHasFocusedWindow: focusedWindow(pid: targetPid),
            checkedAtMs: clock()
        )
        let idle = humanActivity.secondsSinceLastInput()

        var refusals: [PhysicalInputRefusal] = []
        if !implemented(mechanism) { refusals.append(.notImplemented) }
        // A background policy never posts input, whatever the mechanism. `background_only` means
        // AX delivery only.
        if policy.isBackground { refusals.append(.policyForbids) }

        // These three gates exist because the global stream infers its recipient from focus. A
        // targeted post names the process, so requiring a lease, demanding the target be frontmost,
        // and waiting for the human to stop typing would all be guarding against a race that
        // mechanism does not have — and would make Bimax steal focus it does not need.
        if mechanism.dependsOnForeground {
            if !holdsFocusLease { refusals.append(.focusLeaseRequired) }
            if !proof.targetIsFrontmost { refusals.append(.recipientNotFrontmost) }
        }
        if mechanism.sharesInputDeviceWithHuman, (idle ?? 0) < humanQuietPeriodSeconds {
            // An unreadable idle time is treated as the human being active. Silence is not consent.
            refusals.append(.humanActive)
        }

        // Applies to both: typed text lands in whatever the process has focused, so an application
        // with nothing focused would swallow it. Only a definite absence refuses; unreadable is not
        // invented into a verdict.
        if proof.targetHasFocusedWindow == false { refusals.append(.recipientHasNoFocusedWindow) }

        return PhysicalInputDecision(
            allowed: refusals.isEmpty,
            refusals: refusals,
            proof: proof,
            secondsSinceHumanInput: idle
        )
    }

    private func focusedWindow(pid: Int32) -> Bool? {
        if let focusedWindowProbe { return focusedWindowProbe(pid) }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.5)
        var focused: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focused)
        switch status {
        case .success: return focused != nil
        case .noValue, .attributeUnsupported: return false
        // A permission failure or a hung application is unreadable, not an answer.
        default: return nil
        }
    }
}
