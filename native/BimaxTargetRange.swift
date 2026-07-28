/**
 * BimaxTargetRange — a synthetic click-accuracy range for the computer-use runtime.
 *
 * The problem this solves: every existing live check drives a REAL app (Finder, TextEdit, Notes),
 * so "did the click land on the right thing?" has to be inferred from side effects the app happens
 * to expose. That makes a miss and a mis-inference indistinguishable, and it makes the fixture
 * app-specific — which the universal-targeting rule forbids as a source of truth.
 *
 * The range inverts that. It is a target that KNOWS where its own elements are and WHICH one was
 * struck, and says so in machine-readable form:
 *
 *   --manifest <path>   ground truth: every target's id, kind, AX label (or its deliberate absence),
 *                       and rect in GLOBAL TOP-LEFT screen points — the same space the runtime
 *                       plans clicks in. Rewritten whenever the layout changes (child window opened
 *                       or closed), so the harness always reads the current world.
 *   --log <path>        JSON-lines event stream. Every mouseDown is recorded, including the ones
 *                       that hit nothing: a full-bleed background view sits under the targets purely
 *                       so a MISS is a positive observation rather than the absence of a hit.
 *
 * Layout is randomized from --seed with a deterministic PRNG, so a failing run reproduces exactly
 * by rerunning with the seed printed in the report. Cells are laid out on a grid with intra-cell
 * jitter: positions vary run to run, but targets never overlap, which is what makes "the click
 * landed on target N" a well-posed question in the first place.
 *
 * Element mix (the four things worth testing, universal — no app semantics anywhere):
 *   labeled       AXButton with an accessibility label. Semantic targeting should resolve it.
 *   unlabeled     AXButton with NO label, NO title, NO tooltip — a bare colored shape. Reachable
 *                 only by geometry: ordinal/relational phrasing, or raw coordinates read off an
 *                 observation. This is the case real icon toolbars present and the one that
 *                 silently degrades to guessing.
 *   child         labeled AXButton that opens a real separate NSWindow.
 *   sheet         labeled AXButton that opens a real AXSheet (document-modal). Distinct from a
 *                 child window on purpose: the modal guard must confirm modality from AX, never
 *                 infer it from window shape.
 *
 * Build: scripts/build-target-range.sh  →  build/BimaxTargetRange.app
 * Drive: scripts/smoke-computer-range.ts
 */
import AppKit

// MARK: - Deterministic layout randomness

/// SplitMix64 — small, seedable, and identical across runs and machines. Swift's system RNG is
/// explicitly not reproducible, and reproducibility is the whole point of printing the seed.
struct SplitMix64: RandomNumberGenerator {
    private var state: UInt64
    init(seed: UInt64) { self.state = seed }
    mutating func next() -> UInt64 {
        state = state &+ 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

// MARK: - Model

enum TargetKind: String {
    case labeled
    case unlabeled
    case child
    case sheet
    case dismiss
}

enum RangeLayout: String {
    /// 5x4 cells with jitter — the general precision case.
    case grid
    /// one horizontally-separated row — the only layout in which "Nth from the left" is well posed.
    case row
}

enum TargetShape: String, CaseIterable {
    case square, circle, triangle, diamond
}

/// One placeable element. `label` is nil for the unlabeled kind and stays nil all the way into AX.
final class TargetSpec {
    let id: String
    let kind: TargetKind
    let label: String?
    let shape: TargetShape
    let color: NSColor
    /// Which surface it lives on: "main" or the id of the child window / sheet that owns it.
    let surface: String

    init(id: String, kind: TargetKind, label: String?, shape: TargetShape, color: NSColor, surface: String) {
        self.id = id
        self.kind = kind
        self.label = label
        self.shape = shape
        self.color = color
        self.surface = surface
    }
}

// MARK: - Global coordinate helpers
//
// AppKit is bottom-left origin and primary-screen relative; the computer-use runtime plans in
// top-left origin screen points. Every rect and point the range publishes is converted ONCE, here,
// so the harness never has to guess which convention a number is in.

func primaryScreenMaxY() -> CGFloat {
    // .screens.first is the screen owning the (0,0) origin — the anchor for the flip.
    return NSScreen.screens.first?.frame.maxY ?? 0
}

func toGlobalTopLeft(rect: NSRect) -> NSRect {
    return NSRect(x: rect.minX, y: primaryScreenMaxY() - rect.maxY, width: rect.width, height: rect.height)
}

func toGlobalTopLeft(point: NSPoint) -> NSPoint {
    return NSPoint(x: point.x, y: primaryScreenMaxY() - point.y)
}

// MARK: - Event log

/// JSON-lines sink. Flushed per line: the harness reads it while the app is still running, so a
/// buffered write is a lost observation.
final class EventLog {
    private let handle: FileHandle?
    private let queue = DispatchQueue(label: "bimax.range.log")

    init(path: String?) {
        guard let path = path else { handle = nil; return }
        FileManager.default.createFile(atPath: path, contents: Data())
        handle = FileHandle(forWritingAtPath: path)
    }

    func emit(_ payload: [String: Any]) {
        var event = payload
        event["t"] = Date().timeIntervalSince1970
        guard let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]) else { return }
        queue.sync {
            handle?.write(data)
            handle?.write(Data("\n".utf8))
            try? handle?.synchronize()
        }
        // Mirrored to stdout so a manual run is legible without tailing a file.
        if let text = String(data: data, encoding: .utf8) { print(text) }
        fflush(stdout)
    }
}

// MARK: - Views

/// Full-bleed view under every target. Its only job is to turn a miss into a recorded event —
/// without it, "the runtime clicked 40px off" and "the runtime never clicked" look the same.
final class BackgroundView: NSView {
    var onMiss: ((NSPoint) -> Void)?
    override func mouseDown(with event: NSEvent) {
        if let window = window {
            onMiss?(toGlobalTopLeft(point: window.convertPoint(toScreen: event.locationInWindow)))
        }
    }
    // Deliberately NOT an accessibility element: the background must never appear as a clickable
    // candidate, or it would become a legitimate-looking answer to every query.
    override func isAccessibilityElement() -> Bool { false }
}

final class TargetView: NSView {
    let spec: TargetSpec
    var onHit: ((TargetView, NSPoint) -> Void)?

    init(spec: TargetSpec, frame: NSRect) {
        self.spec = spec
        super.init(frame: frame)
        wantsLayer = true
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    override func mouseDown(with event: NSEvent) {
        guard let window = window else { return }
        onHit?(self, toGlobalTopLeft(point: window.convertPoint(toScreen: event.locationInWindow)))
    }

    override func draw(_ dirtyRect: NSRect) {
        let inset = bounds.insetBy(dx: 2, dy: 2)
        let path: NSBezierPath
        switch spec.shape {
        case .square:
            path = NSBezierPath(roundedRect: inset, xRadius: 6, yRadius: 6)
        case .circle:
            path = NSBezierPath(ovalIn: inset)
        case .triangle:
            path = NSBezierPath()
            path.move(to: NSPoint(x: inset.midX, y: inset.maxY))
            path.line(to: NSPoint(x: inset.maxX, y: inset.minY))
            path.line(to: NSPoint(x: inset.minX, y: inset.minY))
            path.close()
        case .diamond:
            path = NSBezierPath()
            path.move(to: NSPoint(x: inset.midX, y: inset.maxY))
            path.line(to: NSPoint(x: inset.maxX, y: inset.midY))
            path.line(to: NSPoint(x: inset.midX, y: inset.minY))
            path.line(to: NSPoint(x: inset.minX, y: inset.midY))
            path.close()
        }
        spec.color.setFill()
        path.fill()
        NSColor.black.withAlphaComponent(0.55).setStroke()
        path.lineWidth = 1.5
        path.stroke()

        // Only labeled kinds paint text. An unlabeled target must be unreadable by OCR too —
        // otherwise the "no label" case quietly becomes a label case and proves nothing.
        guard let label = spec.label else { return }
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 12, weight: .semibold),
            .foregroundColor: NSColor.white,
        ]
        let text = label as NSString
        let size = text.size(withAttributes: attributes)
        text.draw(
            at: NSPoint(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2),
            withAttributes: attributes
        )
    }

    // MARK: accessibility — the surface under test
    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .button }
    override func accessibilityLabel() -> String? { spec.label }
    override func accessibilityTitle() -> String? { spec.label }
    override func isAccessibilityEnabled() -> Bool { true }
    override func accessibilityPerformPress() -> Bool {
        // AXPress must land in the same hit log as a physical click, so a runtime that presses via
        // AX instead of the cursor is scored on identical terms.
        if let window = window {
            let center = window.convertPoint(toScreen: convert(NSPoint(x: bounds.midX, y: bounds.midY), to: nil))
            onHit?(self, toGlobalTopLeft(point: center))
        }
        return true
    }
}

// MARK: - Application

final class RangeController: NSObject, NSWindowDelegate {
    private let seed: UInt64
    private let log: EventLog
    private let manifestPath: String?
    private let layout: RangeLayout
    private var rng: SplitMix64

    private var mainWindow: NSWindow!
    private var targets: [TargetView] = []
    /// Child windows and the open sheet, keyed by the id of the target that spawned them.
    private var childWindows: [String: NSWindow] = [:]
    private var sheetWindow: NSWindow?
    private var sheetOwnerId: String?

    private let labeledWords = [
        "Save", "Archive", "Publish", "Rename", "Export", "Compose", "Refresh", "Restore",
        "Duplicate", "Merge", "Inspect", "Promote",
    ]
    private let palette: [NSColor] = [
        .systemRed, .systemBlue, .systemGreen, .systemOrange, .systemPurple,
        .systemTeal, .systemPink, .systemBrown, .systemIndigo,
    ]

    init(seed: UInt64, targetCount: Int, layout: RangeLayout, log: EventLog, manifestPath: String?) {
        self.seed = seed
        self.log = log
        self.manifestPath = manifestPath
        self.layout = layout
        self.rng = SplitMix64(seed: seed)
        super.init()
        buildMainWindow(targetCount: targetCount)
    }

    // MARK: layout

    private func buildMainWindow(targetCount: Int) {
        let size = NSSize(width: 900, height: 640)
        mainWindow = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        mainWindow.title = "Bimax Target Range"
        mainWindow.delegate = self
        // isReleasedWhenClosed defaults to TRUE for programmatically created NSWindows, so close()
        // releases the window that ARC is also still holding — a double release that segfaults in
        // the next autorelease-pool drain. Every window here is owned by a Swift reference, so the
        // AppKit-era auto-release must be switched off on all of them.
        mainWindow.isReleasedWhenClosed = false
        mainWindow.center()

        let background = BackgroundView(frame: NSRect(origin: .zero, size: size))
        background.autoresizingMask = [.width, .height]
        background.wantsLayer = true
        background.layer?.backgroundColor = NSColor(white: 0.14, alpha: 1).cgColor
        background.onMiss = { [weak self] point in
            self?.log.emit(["event": "miss", "surface": "main", "point": ["x": point.x, "y": point.y]])
        }
        mainWindow.contentView = background

        for (spec, frame) in plan(targetCount: targetCount, in: NSRect(origin: .zero, size: size)) {
            let view = TargetView(spec: spec, frame: frame)
            view.onHit = { [weak self] target, point in self?.handleHit(target, at: point) }
            background.addSubview(view)
            targets.append(view)
        }

        mainWindow.makeKeyAndOrderFront(nil)
    }

    /// Single-row placement, for ordinal phrasing ("the third button from the left").
    ///
    /// The grid layout cannot pose that question: the resolver orders candidates by centre x, and in
    /// a grid four targets share each column's x band, so most ordinals have no single correct
    /// answer. A row gives every target a distinct x — the real case being modelled is an icon
    /// toolbar, which is also where unlabeled buttons actually live.
    private func planRow(targetCount: Int, in content: NSRect) -> [(TargetSpec, NSRect)] {
        let count = min(max(2, targetCount), 8)
        let inset: CGFloat = 24
        let usable = content.insetBy(dx: inset, dy: inset)
        let slot = usable.width / CGFloat(count)

        var kinds: [TargetKind] = [.sheet, .child]
        for index in 0..<max(0, count - kinds.count) { kinds.append(index % 2 == 0 ? .unlabeled : .labeled) }
        kinds.shuffle(using: &rng)
        var words = labeledWords
        words.shuffle(using: &rng)
        var wordCursor = 0
        var planned: [(TargetSpec, NSRect)] = []

        for index in 0..<count {
            let kind = kinds[index]
            // Width is capped to the slot so neighbouring targets can never overlap in x, which is
            // what keeps the left-to-right ordering unambiguous no matter what the seed draws.
            let width = min(slot - 16, CGFloat(Int.random(in: 40...64, using: &rng)))
            let height = CGFloat(Int.random(in: 40...64, using: &rng))
            let slotRect = NSRect(x: usable.minX + CGFloat(index) * slot, y: usable.minY,
                                  width: slot, height: usable.height)
            let frame = NSRect(
                x: slotRect.midX - width / 2,
                // Vertical jitter only: it keeps the row from being a trivially uniform strip
                // without ever disturbing the x ordering the ordinal depends on.
                y: usable.midY - height / 2 + CGFloat(Int.random(in: -80...80, using: &rng)),
                width: width, height: height
            )
            let label: String?
            switch kind {
            case .unlabeled: label = nil
            case .labeled: label = words[wordCursor % words.count]; wordCursor += 1
            case .child: label = "Open Panel 1"
            case .sheet: label = "Open Sheet"
            case .dismiss: label = "Close"
            }
            planned.append((TargetSpec(
                id: "t\(index + 1)", kind: kind, label: label,
                shape: TargetShape.allCases.randomElement(using: &rng) ?? .square,
                color: palette.randomElement(using: &rng) ?? .systemBlue, surface: "main"
            ), frame))
        }
        return planned
    }

    /// Grid-with-jitter placement. The grid guarantees separation (so a hit is unambiguous); the
    /// jitter and the random cell/kind/label draw guarantee the run is not memorizable.
    private func plan(targetCount: Int, in content: NSRect) -> [(TargetSpec, NSRect)] {
        if layout == .row { return planRow(targetCount: targetCount, in: content) }
        let columns = 5, rows = 4
        let inset: CGFloat = 24
        let usable = content.insetBy(dx: inset, dy: inset)
        let cellW = usable.width / CGFloat(columns)
        let cellH = usable.height / CGFloat(rows)

        // Choose which cells are occupied. Empty cells are load-bearing: they are where a miss can
        // be recorded as a miss instead of accidentally striking a neighbouring target.
        var cells = Array(0..<(columns * rows))
        cells.shuffle(using: &rng)
        let count = min(targetCount, cells.count)
        let chosen = Array(cells.prefix(count))

        // Kind mix. Exactly one sheet spawner and two child spawners, the rest split between
        // labeled and unlabeled — enough unlabeled decoys that ordinal targeting has to disambiguate.
        var kinds: [TargetKind] = [.sheet, .child, .child]
        let remaining = max(0, count - kinds.count)
        for index in 0..<remaining {
            kinds.append(index % 2 == 0 ? .labeled : .unlabeled)
        }
        kinds.shuffle(using: &rng)

        var words = labeledWords
        words.shuffle(using: &rng)
        var wordCursor = 0
        var planned: [(TargetSpec, NSRect)] = []

        for (index, cell) in chosen.enumerated() {
            let kind = kinds[index]
            let column = cell % columns
            let row = cell / columns
            let cellRect = NSRect(
                x: usable.minX + CGFloat(column) * cellW,
                y: usable.minY + CGFloat(row) * cellH,
                width: cellW, height: cellH
            )
            // Size and offset jitter, clamped so the target always stays inside its own cell.
            let width = CGFloat(Int.random(in: 52...92, using: &rng))
            let height = CGFloat(Int.random(in: 40...64, using: &rng))
            let slackX = max(0, cellRect.width - width - 8)
            let slackY = max(0, cellRect.height - height - 8)
            let frame = NSRect(
                x: cellRect.minX + 4 + CGFloat(Int.random(in: 0...max(0, Int(slackX)), using: &rng)),
                y: cellRect.minY + 4 + CGFloat(Int.random(in: 0...max(0, Int(slackY)), using: &rng)),
                width: width, height: height
            )

            let label: String?
            switch kind {
            case .unlabeled:
                label = nil
            case .labeled:
                label = words[wordCursor % words.count]; wordCursor += 1
            case .child:
                label = "Open Panel \(planned.filter { $0.0.kind == .child }.count + 1)"
            case .sheet:
                label = "Open Sheet"
            case .dismiss:
                label = "Close"
            }

            let spec = TargetSpec(
                id: "t\(index + 1)",
                kind: kind,
                label: label,
                shape: TargetShape.allCases.randomElement(using: &rng) ?? .square,
                color: palette.randomElement(using: &rng) ?? .systemBlue,
                surface: "main"
            )
            planned.append((spec, frame))
        }
        return planned
    }

    // MARK: hits

    private func handleHit(_ view: TargetView, at point: NSPoint) {
        let rect = globalRect(of: view)
        let center = NSPoint(x: rect.midX, y: rect.midY)
        log.emit([
            "event": "hit",
            "id": view.spec.id,
            "kind": view.spec.kind.rawValue,
            "surface": view.spec.surface,
            "label": view.spec.label ?? NSNull(),
            "point": ["x": point.x, "y": point.y],
            "rect": ["x": rect.minX, "y": rect.minY, "w": rect.width, "h": rect.height],
            // Offset from the geometric centre, in points. This is the precision number: a runtime
            // can hit the right element and still be drifting toward its edge.
            "offset": ["dx": point.x - center.x, "dy": point.y - center.y],
        ])

        switch view.spec.kind {
        case .child: openChildWindow(for: view.spec)
        case .sheet: openSheet(for: view.spec)
        case .dismiss: dismissSurface(owning: view.spec)
        case .labeled, .unlabeled: break
        }
    }

    private func globalRect(of view: NSView) -> NSRect {
        guard let window = view.window else { return .zero }
        return toGlobalTopLeft(rect: window.convertToScreen(view.convert(view.bounds, to: nil)))
    }

    // MARK: spawned surfaces

    /// A real separate top-level window — a new CGWindowID the runtime must notice and retarget to.
    private func openChildWindow(for spec: TargetSpec) {
        if let existing = childWindows[spec.id] { existing.makeKeyAndOrderFront(nil); return }
        let size = NSSize(width: 340, height: 200)
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable],
            backing: .buffered, defer: false
        )
        window.title = "Panel \(spec.id)"
        window.delegate = self
        window.isReleasedWhenClosed = false

        let background = BackgroundView(frame: NSRect(origin: .zero, size: size))
        background.wantsLayer = true
        background.layer?.backgroundColor = NSColor(white: 0.2, alpha: 1).cgColor
        background.onMiss = { [weak self] point in
            self?.log.emit(["event": "miss", "surface": spec.id, "point": ["x": point.x, "y": point.y]])
        }
        window.contentView = background

        // One labeled confirm and one unlabeled target inside the child: reaching them at all
        // requires the runtime to have retargeted to the new window, and the unlabeled one keeps
        // the geometry case alive on a surface that did not exist when the run started.
        add(
            TargetSpec(id: "\(spec.id)-confirm", kind: .labeled, label: "Confirm \(spec.id)",
                       shape: .square, color: .systemGreen, surface: spec.id),
            frame: NSRect(x: 30, y: 40, width: 130, height: 48), to: background
        )
        add(
            TargetSpec(id: "\(spec.id)-dot", kind: .unlabeled, label: nil,
                       shape: .circle, color: .systemOrange, surface: spec.id),
            frame: NSRect(x: 200, y: 40, width: 60, height: 48), to: background
        )
        add(
            TargetSpec(id: "\(spec.id)-close", kind: .dismiss, label: "Close",
                       shape: .square, color: .systemGray, surface: spec.id),
            frame: NSRect(x: 30, y: 120, width: 130, height: 44), to: background
        )

        // Offset from the parent so the child never lands exactly on top of the spawner, which
        // would let a stale-frame click score as a child-window hit.
        var origin = mainWindow.frame.origin
        origin.x += 420
        origin.y += 120
        window.setFrameOrigin(origin)
        window.makeKeyAndOrderFront(nil)
        childWindows[spec.id] = window

        log.emit([
            "event": "child-window-open",
            "id": spec.id,
            "windowNumber": window.windowNumber,
            "title": window.title,
            "rect": rectPayload(toGlobalTopLeft(rect: window.frame)),
        ])
        writeManifest()
    }

    /// A document-modal AXSheet. Distinct from a child window on purpose: modality has to be read
    /// from AX, and a sheet is the case where guessing from window shape goes wrong.
    private func openSheet(for spec: TargetSpec) {
        guard sheetWindow == nil else { return }
        let size = NSSize(width: 360, height: 160)
        let sheet = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled], backing: .buffered, defer: false
        )
        sheet.title = "Sheet \(spec.id)"
        sheet.isReleasedWhenClosed = false

        let background = BackgroundView(frame: NSRect(origin: .zero, size: size))
        background.wantsLayer = true
        background.layer?.backgroundColor = NSColor(white: 0.26, alpha: 1).cgColor
        background.onMiss = { [weak self] point in
            self?.log.emit(["event": "miss", "surface": spec.id, "point": ["x": point.x, "y": point.y]])
        }
        sheet.contentView = background

        add(
            TargetSpec(id: "\(spec.id)-accept", kind: .labeled, label: "Accept",
                       shape: .square, color: .systemBlue, surface: spec.id),
            frame: NSRect(x: 40, y: 40, width: 120, height: 46), to: background
        )
        add(
            TargetSpec(id: "\(spec.id)-close", kind: .dismiss, label: "Dismiss",
                       shape: .square, color: .systemGray, surface: spec.id),
            frame: NSRect(x: 200, y: 40, width: 120, height: 46), to: background
        )

        sheetWindow = sheet
        sheetOwnerId = spec.id
        mainWindow.beginSheet(sheet) { [weak self] _ in
            self?.sheetWindow = nil
            self?.sheetOwnerId = nil
            self?.writeManifest()
        }
        log.emit([
            "event": "sheet-open",
            "id": spec.id,
            "windowNumber": sheet.windowNumber,
            "rect": rectPayload(toGlobalTopLeft(rect: sheet.frame)),
        ])
        writeManifest()
    }

    private func dismissSurface(owning spec: TargetSpec) {
        if sheetOwnerId == spec.surface, let sheet = sheetWindow {
            mainWindow.endSheet(sheet)
            log.emit(["event": "sheet-close", "id": spec.surface])
            return
        }
        if let window = childWindows.removeValue(forKey: spec.surface) {
            window.orderOut(nil)
            window.close()
            log.emit(["event": "child-window-close", "id": spec.surface])
            writeManifest()
        }
    }

    private func add(_ spec: TargetSpec, frame: NSRect, to parent: NSView) {
        let view = TargetView(spec: spec, frame: frame)
        view.onHit = { [weak self] target, point in self?.handleHit(target, at: point) }
        parent.addSubview(view)
        targets.append(view)
    }

    // MARK: manifest

    private func rectPayload(_ rect: NSRect) -> [String: CGFloat] {
        return ["x": rect.minX, "y": rect.minY, "w": rect.width, "h": rect.height]
    }

    /// Ground truth, rewritten on every layout change. Written to a temp file and renamed so the
    /// harness can never read a half-written manifest.
    func writeManifest() {
        guard let path = manifestPath else { return }
        let live = targets.filter { $0.window != nil && $0.window?.isVisible == true }

        // Per-surface window rects in global points. The harness needs these to convert the
        // screenshot-pixel frames an observation reports back into the space this manifest speaks:
        // element geometry alone cannot be compared across those two spaces, and silently comparing
        // them anyway is exactly the class of error this fixture exists to catch.
        var surfaces: [String: [String: CGFloat]] = ["main": rectPayload(toGlobalTopLeft(rect: mainWindow.frame))]
        for (id, window) in childWindows where window.isVisible {
            surfaces[id] = rectPayload(toGlobalTopLeft(rect: window.frame))
        }
        if let owner = sheetOwnerId, let sheet = sheetWindow, sheet.isVisible {
            surfaces[owner] = rectPayload(toGlobalTopLeft(rect: sheet.frame))
        }

        let payload: [String: Any] = [
            "seed": String(seed),
            "app": "Bimax Target Range",
            "layout": layout.rawValue,
            "screen": rectPayload(toGlobalTopLeft(rect: NSScreen.screens.first?.frame ?? .zero)),
            "mainWindow": rectPayload(toGlobalTopLeft(rect: mainWindow.frame)),
            "surfaces": surfaces,
            "openSurfaces": [String](childWindows.keys) + (sheetOwnerId.map { [$0] } ?? []),
            "targets": live.map { view -> [String: Any] in
                let rect = globalRect(of: view)
                return [
                    "id": view.spec.id,
                    "kind": view.spec.kind.rawValue,
                    "label": view.spec.label ?? NSNull(),
                    "shape": view.spec.shape.rawValue,
                    "surface": view.spec.surface,
                    "rect": rectPayload(rect),
                    "center": ["x": rect.midX, "y": rect.midY],
                ]
            },
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) else { return }
        let temp = path + ".tmp"
        try? data.write(to: URL(fileURLWithPath: temp))
        _ = try? FileManager.default.replaceItemAt(URL(fileURLWithPath: path), withItemAt: URL(fileURLWithPath: temp))
    }

    /// Close every spawned surface and return to the opening layout.
    ///
    /// Reachable by SIGUSR1 because a phase that fails to reach INTO a child window cannot be
    /// expected to click its Close button either — without an out-of-band reset, the first blocked
    /// phase leaves a window (or worse, a modal sheet) covering the range and every later phase
    /// fails for a reason that has nothing to do with what it was testing.
    func resetSurfaces() {
        if let sheet = sheetWindow { mainWindow.endSheet(sheet) }
        sheetWindow = nil
        sheetOwnerId = nil
        // Close first, clear the dictionary afterwards: dropping the last strong reference in the
        // same iteration as close() frees the window while AppKit is still unwinding it.
        for window in childWindows.values { window.orderOut(nil); window.close() }
        childWindows.removeAll()
        targets.removeAll { $0.spec.surface != "main" }
        mainWindow.makeKeyAndOrderFront(nil)
        log.emit(["event": "reset"])
        writeManifest()
    }

    func windowWillClose(_ notification: Notification) {
        guard let closing = notification.object as? NSWindow else { return }
        if closing === mainWindow { NSApp.terminate(nil) }
    }
}

// MARK: - Entry point

@main
struct BimaxTargetRange {
    static func main() {
        var seed: UInt64 = 1
        var targetCount = 14
        var logPath: String?
        var manifestPath: String?
        var layout: RangeLayout = .grid

        var arguments = Array(CommandLine.arguments.dropFirst())
        while let flag = arguments.first {
            arguments.removeFirst()
            switch flag {
            case "--seed":
                if let value = arguments.first { seed = UInt64(value) ?? 1; arguments.removeFirst() }
            case "--targets":
                if let value = arguments.first { targetCount = Int(value) ?? 14; arguments.removeFirst() }
            case "--log":
                if let value = arguments.first { logPath = value; arguments.removeFirst() }
            case "--manifest":
                if let value = arguments.first { manifestPath = value; arguments.removeFirst() }
            case "--layout":
                if let value = arguments.first { layout = RangeLayout(rawValue: value) ?? .grid; arguments.removeFirst() }
            default:
                break
            }
        }

        let application = NSApplication.shared
        // .regular: the range must be a normal, activatable, AX-visible application. An accessory
        // app would be a different (easier) targeting problem than the one under test.
        application.setActivationPolicy(.regular)

        let log = EventLog(path: logPath)
        let controller = RangeController(seed: seed, targetCount: targetCount, layout: layout, log: log, manifestPath: manifestPath)

        // The manifest is only correct once the window has a real on-screen frame, which is after
        // the first pass of the run loop — not at construction time.
        DispatchQueue.main.async {
            controller.writeManifest()
            log.emit(["event": "ready", "seed": String(seed), "layout": layout.rawValue])
            application.activate(ignoringOtherApps: true)
        }

        // SIGUSR1 → close every spawned surface. A DispatchSource (not a C signal handler) is what
        // makes this safe: the reset touches AppKit, which may only be done on the main queue.
        // SIG_IGN first, or the default disposition terminates the process before the source runs.
        signal(SIGUSR1, SIG_IGN)
        let resetSignal = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
        resetSignal.setEventHandler { controller.resetSurfaces() }
        resetSignal.resume()

        // Retained for the process lifetime; the controller owns the windows.
        objc_setAssociatedObject(application, "bimax.range.controller", controller, .OBJC_ASSOCIATION_RETAIN)
        objc_setAssociatedObject(application, "bimax.range.reset", resetSignal, .OBJC_ASSOCIATION_RETAIN)
        application.run()
    }
}
