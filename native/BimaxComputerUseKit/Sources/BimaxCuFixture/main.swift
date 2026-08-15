import AppKit
import Foundation

// BimaxCuFixture: the §23.2 fixture application.
//
// It exists so the advertised semantic action catalog can be proven against a real Accessibility
// server without pressing buttons or overwriting text in the user's own applications. Every
// control is inert — it records that it was actuated and changes only its own state.
//
// The window reports each control's observed state so a conformance run can verify that an action
// had a real effect, not merely that an AX call returned success.

nonisolated(unsafe) var fixtureDelegate: AnyObject?

@MainActor
final class FixtureState {
    private(set) var pressCount = 0
    private(set) var log: [String] = []

    func record(_ event: String) {
        log.append(event)
        if event == "press" { pressCount += 1 }
    }
}

@MainActor
final class FixtureController: NSObject, NSApplicationDelegate, NSTableViewDataSource, NSTableViewDelegate {
    private var window: NSWindow!
    private let state = FixtureState()
    private let statusLabel = NSTextField(labelWithString: "ready")
    private var rows = (1...40).map { "Row \($0)" }
    private var captureTimer: Timer?
    private weak var capturePulse: NSView?
    private var capturePulseLight = false
    private var persistenceTimer: Timer?
    private var reminderStateURL: URL?
    private weak var momDemoTimeField: NSTextField?
    private weak var dentistTimeField: NSTextField?
    private var lastReminderState: [String: String] = [:]
    private var typingStateURL: URL?
    private weak var typingRecorder: NSTextView?
    private var lastTypingValue = ""

    func applicationDidFinishLaunching(_ notification: Notification) {
        if CommandLine.arguments.contains("--bystander-fixture") {
            buildBystanderFixture()
            return
        }
        let hasM02Fixture = CommandLine.arguments.contains("--m02-fixture")
        window = NSWindow(
            contentRect: NSRect(x: 200, y: 200, width: 560, height: hasM02Fixture ? 560 : 460),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Bimax-Cu Fixture"
        window.setAccessibilityIdentifier("bimax-cu-fixture-window")
        // Focus conformance deliberately activates another application. Keep this inert test
        // window present on every Space so staging Finder cannot turn an activation check into an
        // unrelated `window_not_found` failure when Finder belongs to a different Space.
        window.collectionBehavior.insert(.canJoinAllSpaces)

        let content = NSView(frame: window.contentLayoutRect)
        content.autoresizingMask = [.width, .height]

        let button = NSButton(title: "Fixture Button", target: self, action: #selector(pressed))
        button.frame = NSRect(x: 20, y: 400, width: 160, height: 32)
        button.setAccessibilityIdentifier("fixture-button")

        let checkbox = NSButton(checkboxWithTitle: "Fixture Checkbox", target: self, action: #selector(toggled))
        checkbox.frame = NSRect(x: 200, y: 404, width: 180, height: 24)
        checkbox.setAccessibilityIdentifier("fixture-checkbox")

        let field = NSTextField(string: "alpha beta gamma")
        field.frame = NSRect(x: 20, y: 360, width: 300, height: 24)
        field.setAccessibilityIdentifier("fixture-textfield")

        let slider = NSSlider(value: 25, minValue: 0, maxValue: 100, target: self, action: #selector(slid))
        slider.frame = NSRect(x: 20, y: 320, width: 300, height: 24)
        slider.setAccessibilityIdentifier("fixture-slider")

        let stepper = NSStepper(frame: NSRect(x: 340, y: 318, width: 20, height: 28))
        stepper.minValue = 0
        stepper.maxValue = 100
        stepper.doubleValue = 5
        stepper.target = self
        stepper.action = #selector(stepped)
        stepper.setAccessibilityIdentifier("fixture-stepper")

        let popup = NSPopUpButton(frame: NSRect(x: 380, y: 398, width: 150, height: 26))
        popup.addItems(withTitles: ["First", "Second", "Third"])
        popup.setAccessibilityIdentifier("fixture-popup")

        // NSComboBox is the standard AppKit control that exposes AXExpanded.
        let combo = NSComboBox(frame: NSRect(x: 380, y: 358, width: 150, height: 26))
        combo.addItems(withObjectValues: ["One", "Two", "Three"])
        combo.setAccessibilityIdentifier("fixture-combo")

        // Radio buttons exist to exercise the *fallthrough* of the delivery ladder. A table row
        // answers `select` on its first rung (settable AXSelected); a radio button is expected to
        // refuse that rung and answer the second one (AXPress), so conformance can prove the
        // ladder walks rather than only ever succeeding on rung one.
        let radioOne = NSButton(radioButtonWithTitle: "One", target: self, action: #selector(chose))
        radioOne.frame = NSRect(x: 380, y: 320, width: 70, height: 20)
        radioOne.setAccessibilityIdentifier("fixture-radio-one")

        let radioTwo = NSButton(radioButtonWithTitle: "Two", target: self, action: #selector(chose))
        radioTwo.frame = NSRect(x: 455, y: 320, width: 70, height: 20)
        radioTwo.setAccessibilityIdentifier("fixture-radio-two")

        var titleUIElementFixtureViews: [NSView] = []
        if CommandLine.arguments.contains("--title-ui-element-fixture") {
            // A control whose human-readable name deliberately lives only in AXTitleUIElement.
            // This opt-in fixture is excluded from baseline runs, keeping their control set frozen.
            // The visible sibling is the label; the empty-title button remains the action target.
            let linkedLabel = NSTextField(labelWithString: "Linked Fixture Control")
            linkedLabel.frame = NSRect(x: 380, y: 276, width: 125, height: 20)
            linkedLabel.setAccessibilityIdentifier("fixture-linked-label")
            let linkedButton = NSButton(title: "", target: self, action: #selector(pressed))
            linkedButton.frame = NSRect(x: 510, y: 272, width: 24, height: 24)
            linkedButton.setAccessibilityIdentifier("fixture-linked-button")
            linkedButton.setAccessibilityTitleUIElement(linkedLabel)
            titleUIElementFixtureViews = [linkedLabel, linkedButton]
        }

        var m02FixtureViews: [NSView] = []
        if hasM02Fixture {
            let statePath = argument(after: "--m02-state")
                ?? FileManager.default.temporaryDirectory.appendingPathComponent("bimax-m02-reminders.json").path
            reminderStateURL = URL(fileURLWithPath: statePath)
            let restored = loadReminderState() ?? ["Mom demo": "6:00 PM", "Dentist": "9:00 AM"]
            lastReminderState = restored

            let heading = NSTextField(labelWithString: "Persistent reminder fixture")
            heading.frame = NSRect(x: 20, y: 520, width: 260, height: 20)
            heading.setAccessibilityIdentifier("fixture-reminder-heading")

            let momLabel = NSTextField(labelWithString: "Mom demo")
            momLabel.frame = NSRect(x: 20, y: 488, width: 140, height: 24)
            momLabel.setAccessibilityIdentifier("fixture-reminder-mom-demo-label")
            let momTime = NSTextField(string: restored["Mom demo"] ?? "6:00 PM")
            momTime.frame = NSRect(x: 170, y: 486, width: 140, height: 24)
            momTime.setAccessibilityIdentifier("fixture-reminder-mom-demo-time")
            momDemoTimeField = momTime

            let dentistLabel = NSTextField(labelWithString: "Dentist")
            dentistLabel.frame = NSRect(x: 330, y: 488, width: 80, height: 24)
            dentistLabel.setAccessibilityIdentifier("fixture-reminder-dentist-label")
            let dentistTime = NSTextField(string: restored["Dentist"] ?? "9:00 AM")
            dentistTime.frame = NSRect(x: 410, y: 486, width: 120, height: 24)
            dentistTime.setAccessibilityIdentifier("fixture-reminder-dentist-time")
            dentistTimeField = dentistTime
            m02FixtureViews = [heading, momLabel, momTime, dentistLabel, dentistTime]
            persistReminderState(restored)
        }

        // A text view, unlike a text field, exposes a settable AXSelectedTextRange without focus.
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 200, height: 60))
        textView.string = "alpha beta gamma delta"
        textView.isEditable = true
        textView.setAccessibilityIdentifier("fixture-textview")
        let textScroll = NSScrollView(frame: NSRect(x: 20, y: 250, width: 340, height: 60))
        textScroll.documentView = textView
        textScroll.hasVerticalScroller = true
        textScroll.setAccessibilityIdentifier("fixture-textview-scroll")

        let table = NSTableView()
        table.addTableColumn(NSTableColumn(identifier: .init("name")))
        table.headerView = nil
        table.dataSource = self
        table.delegate = self
        table.allowsMultipleSelection = true
        table.setAccessibilityIdentifier("fixture-table")

        let scroll = NSScrollView(frame: NSRect(x: 20, y: 60, width: 510, height: 180))
        scroll.hasVerticalScroller = true
        scroll.documentView = table
        scroll.autoresizingMask = [.width, .height]
        scroll.setAccessibilityIdentifier("fixture-scroll")

        statusLabel.frame = NSRect(x: 20, y: 24, width: 510, height: 24)
        statusLabel.setAccessibilityIdentifier("fixture-status")

        // ScreenCaptureKit may emit only a startup-status sample for a completely static window.
        // This non-accessible pulse changes two pixels without mutating any semantic control, so
        // capture conformance can require a real `.complete` content frame rather than accepting
        // startup metadata as image evidence.
        let pulse = NSView(frame: NSRect(x: 548, y: 448, width: 2, height: 2))
        pulse.wantsLayer = true
        pulse.setAccessibilityElement(false)
        pulse.layer?.backgroundColor = NSColor(calibratedWhite: 0.92, alpha: 1).cgColor
        capturePulse = pulse

        let standardViews = [button, checkbox, field, slider, stepper, popup, combo,
                             radioOne, radioTwo, textScroll, scroll, statusLabel, pulse] as [NSView]
        for view in standardViews + titleUIElementFixtureViews + m02FixtureViews {
            content.addSubview(view)
        }
        window.contentView = content
        window.makeKeyAndOrderFront(nil)
        NSApp.setActivationPolicy(.regular)
        refresh()
        captureTimer = Timer.scheduledTimer(
            timeInterval: 0.25, target: self, selector: #selector(tickCapturePulse),
            userInfo: nil, repeats: true
        )
        if hasM02Fixture {
            persistenceTimer = Timer.scheduledTimer(
                timeInterval: 0.1, target: self, selector: #selector(pollReminderPersistence),
                userInfo: nil, repeats: true
            )
        }
    }

    private func buildBystanderFixture() {
        let statePath = argument(after: "--typing-state")
            ?? FileManager.default.temporaryDirectory.appendingPathComponent("bimax-m02-typing.txt").path
        typingStateURL = URL(fileURLWithPath: statePath)
        try? Data().write(to: typingStateURL!, options: .atomic)

        window = NSWindow(
            contentRect: NSRect(x: 820, y: 300, width: 520, height: 220),
            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false
        )
        window.title = "M02 Notes Typing Recorder"
        window.setAccessibilityIdentifier("bimax-m02-bystander-window")
        window.collectionBehavior.insert(.canJoinAllSpaces)
        let recorder = NSTextView(frame: NSRect(x: 16, y: 16, width: 488, height: 188))
        recorder.string = ""
        recorder.isEditable = true
        recorder.setAccessibilityIdentifier("fixture-typing-recorder")
        typingRecorder = recorder
        window.contentView = recorder
        window.makeKeyAndOrderFront(nil)
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        window.makeFirstResponder(recorder)
        persistenceTimer = Timer.scheduledTimer(
            timeInterval: 0.05, target: self, selector: #selector(pollTypingPersistence),
            userInfo: nil, repeats: true
        )
    }

    private func argument(after flag: String) -> String? {
        guard let index = CommandLine.arguments.firstIndex(of: flag),
              CommandLine.arguments.indices.contains(index + 1) else { return nil }
        return CommandLine.arguments[index + 1]
    }

    private func loadReminderState() -> [String: String]? {
        guard let reminderStateURL,
              let data = try? Data(contentsOf: reminderStateURL),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: String]
        else { return nil }
        return value
    }

    private func persistReminderState(_ state: [String: String]) {
        guard let reminderStateURL,
              let data = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys])
        else { return }
        try? data.write(to: reminderStateURL, options: .atomic)
    }

    @objc private func pollReminderPersistence() {
        guard let momDemoTimeField, let dentistTimeField else { return }
        let current = [
            "Mom demo": momDemoTimeField.stringValue,
            "Dentist": dentistTimeField.stringValue,
        ]
        guard current != lastReminderState else { return }
        lastReminderState = current
        persistReminderState(current)
    }

    @objc private func pollTypingPersistence() {
        guard let typingRecorder, let typingStateURL else { return }
        let current = typingRecorder.string
        guard current != lastTypingValue else { return }
        lastTypingValue = current
        try? Data(current.utf8).write(to: typingStateURL, options: .atomic)
    }

    @objc private func tickCapturePulse() {
        capturePulseLight.toggle()
        capturePulse?.layer?.backgroundColor = NSColor(
            calibratedWhite: capturePulseLight ? 0.70 : 0.96, alpha: 1
        ).cgColor
        capturePulse?.needsDisplay = true
    }

    /// A regular AppKit application cooperates with a LaunchServices reopen request by presenting
    /// its existing window and activating itself. The desktop focus-broker conformance uses this
    /// standard application boundary; the service still has to observe the exact PID afterward.
    func applicationShouldHandleReopen(
        _ sender: NSApplication,
        hasVisibleWindows flag: Bool
    ) -> Bool {
        window.makeKeyAndOrderFront(nil)
        if #available(macOS 14.0, *) { sender.activate() }
        else { sender.activate(ignoringOtherApps: true) }
        return true
    }

    @objc private func pressed() { state.record("press"); refresh() }
    @objc private func toggled() { state.record("toggle"); refresh() }
    @objc private func slid() { state.record("slide"); refresh() }
    @objc private func stepped() { state.record("step"); refresh() }
    @objc private func chose() { state.record("choose"); refresh() }

    private func refresh() {
        statusLabel.stringValue = "presses=\(state.pressCount) events=\(state.log.count) last=\(state.log.last ?? "none")"
    }

    func numberOfRows(in tableView: NSTableView) -> Int { rows.count }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let label = NSTextField(labelWithString: rows[row])
        label.setAccessibilityIdentifier("fixture-row-\(row)")
        return label
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        state.record("select")
        refresh()
    }
}

MainActor.assumeIsolated {
    let application = NSApplication.shared
    let controller = FixtureController()
    // The delegate must outlive this scope; NSApplication holds it weakly.
    fixtureDelegate = controller
    application.delegate = controller
    application.run()
}
