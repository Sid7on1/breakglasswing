import ApplicationServices
import CoreGraphics
import Foundation
import BimaxCuProtocol

/// Types Unicode text through an explicitly selected physical mechanism.
///
/// The currently advertised route is the WindowServer/HID stream, guarded by coordinator approval,
/// an exact-PID focus lease, a human-input quiet period and a click on the same live AX element.
/// `CGEvent.postToPid` remains available here only for falsification: current macOS can acknowledge
/// that call without changing the background target, so the service does not advertise it.
public struct TargetedKeyboardInput: Sendable {
    /// A private source so these events are distinguishable from the human's, and so they never
    /// inherit modifier state the person is physically holding down.
    private static func makeSource(for mechanism: PhysicalInputMechanism) -> CGEventSource? {
        CGEventSource(stateID: mechanism == .globalStream ? .hidSystemState : .privateState)
    }

    /// macOS delivers at most this many UTF-16 units per event; longer text is chunked.
    private static let maxUnitsPerEvent = 20

    public init() {}

    /// Focuses `element`, types `text` into `pid`, and reports what the control actually contains
    /// afterwards.
    ///
    /// `honored` is the read-back, not the post result: posting an event never reports whether the
    /// application consumed it, and this kit has been bitten four times by calls that returned
    /// success and changed nothing.
    public func type(
        _ text: String,
        into element: AXUIElement,
        pid: Int32,
        mechanism: PhysicalInputMechanism,
        validateBeforeMutation: () throws -> Void
    ) throws -> AXActionExecution {
        guard !text.isEmpty, text.count <= 4_096 else { throw AXSemanticActionError.invalidPayload }
        guard !text.contains("\0") else { throw AXSemanticActionError.invalidPayload }
        guard let source = Self.makeSource(for: mechanism) else {
            throw AXSemanticActionError.executionFailed(.failure)
        }

        // Typing goes to whatever the process has focused, so focus must be established and
        // confirmed first. An unfocusable element would otherwise send the text somewhere else in
        // the same application.
        let focusResult = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        guard focusResult == .success else { throw AXSemanticActionError.executionFailed(focusResult) }
        var focusedValue: CFTypeRef?
        let focusRead = AXUIElementCopyAttributeValue(element, kAXFocusedAttribute as CFString, &focusedValue)
        guard focusRead == .success, (focusedValue as? NSNumber)?.boolValue == true else {
            // The write reported success and the element is not focused. Refuse rather than type
            // into whichever control this application actually has focused.
            throw AXSemanticActionError.focusNotHonored
        }

        // A foreground app installs/retargets its field editor on the main run loop. AX can report
        // focused before that editor is ready to consume a WindowServer event, so give it one
        // bounded turn rather than firing into the transition.
        if mechanism == .globalStream { Thread.sleep(forTimeInterval: 0.1) }

        if mechanism == .globalStream {
            // AX focus read-back is not proof that AppKit has installed the field editor. The
            // foreground physical rung therefore performs an exact center click on the same live
            // AX element before typing. This intentionally moves the pointer and is reachable only
            // after the service's approval, focus-lease, recipient and quiet-period gates.
            try Self.clickCenter(of: element, source: source)
            Thread.sleep(forTimeInterval: 0.1)
        }

        let before = Self.stringAttribute(element, kAXValueAttribute)
        try validateBeforeMutation()

        for chunk in Array(text.utf16).chunked(into: Self.maxUnitsPerEvent) {
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
                throw AXSemanticActionError.executionFailed(.failure)
            }
            var units = chunk
            down.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
            up.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
            switch mechanism {
            case .targetedProcess:
                down.postToPid(pid)
                up.postToPid(pid)
            case .globalStream:
                // The service acquires and validates the exact-PID foreground lease before this
                // branch is reachable. Posting through the WindowServer is the real physical
                // keyboard path; it is never used under a background policy.
                down.post(tap: .cghidEventTap)
                Thread.sleep(forTimeInterval: 0.01)
                up.post(tap: .cghidEventTap)
            }
        }

        // Applications process input on their own run loop; a read taken immediately would be a
        // race, and reporting an unsettled value as "not honored" would be as wrong as assuming it.
        let after = Self.settledValue(element, changedFrom: before)
        let global = mechanism == .globalStream
        let primitive = global ? "CGEventPost:cghidEventTap:unicode" : "CGEventPostToPid:unicode"
        let deliveryPath: DeliveryPath = global ? .physicalCgEvent : .targetedEvent
        return AXActionExecution(
            primitive: primitive,
            outcome: .performed,
            deliveryPath: deliveryPath,
            attemptedPaths: [.init(path: deliveryPath, primitive: primitive, outcome: .performed)],
            typedText: TypedTextReceipt(
                requestedUnitCount: text.utf16.count,
                characterCountBefore: before?.count,
                characterCountAfter: after?.count,
                // Content never enters a receipt: this is a length comparison, not the text.
                honored: (before == nil || after == nil) ? nil : after != before
            )
        )
    }

    private static func settledValue(_ element: AXUIElement, changedFrom before: String?) -> String? {
        let deadline = Date().addingTimeInterval(1.0)
        var latest = stringAttribute(element, kAXValueAttribute)
        while latest == before && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
            latest = stringAttribute(element, kAXValueAttribute)
        }
        return latest
    }

    private static func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value as? String
    }

    private static func clickCenter(of element: AXUIElement, source: CGEventSource) throws {
        var positionValue: CFTypeRef?
        var sizeValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(
            element, kAXPositionAttribute as CFString, &positionValue
        ) == .success,
        AXUIElementCopyAttributeValue(
            element, kAXSizeAttribute as CFString, &sizeValue
        ) == .success,
        let rawPosition = positionValue, let rawSize = sizeValue,
        CFGetTypeID(rawPosition) == AXValueGetTypeID(),
        CFGetTypeID(rawSize) == AXValueGetTypeID() else {
            throw AXSemanticActionError.executionFailed(.noValue)
        }
        let position = unsafeDowncast(rawPosition, to: AXValue.self)
        let size = unsafeDowncast(rawSize, to: AXValue.self)
        var origin = CGPoint.zero
        var dimensions = CGSize.zero
        guard AXValueGetValue(position, .cgPoint, &origin),
              AXValueGetValue(size, .cgSize, &dimensions),
              dimensions.width > 0, dimensions.height > 0 else {
            throw AXSemanticActionError.executionFailed(.illegalArgument)
        }
        let point = CGPoint(x: origin.x + dimensions.width / 2, y: origin.y + dimensions.height / 2)
        guard let move = CGEvent(
            mouseEventSource: source, mouseType: .mouseMoved,
            mouseCursorPosition: point, mouseButton: .left
        ), let down = CGEvent(
            mouseEventSource: source, mouseType: .leftMouseDown,
            mouseCursorPosition: point, mouseButton: .left
        ), let up = CGEvent(
            mouseEventSource: source, mouseType: .leftMouseUp,
            mouseCursorPosition: point, mouseButton: .left
        ) else { throw AXSemanticActionError.executionFailed(.failure) }
        move.post(tap: .cghidEventTap)
        down.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.02)
        up.post(tap: .cghidEventTap)
    }
}

extension Array {
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else { return [self] }
        return stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}
