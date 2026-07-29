import AppKit
import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import ScreenCaptureKit

private struct Arguments {
    let pid: pid_t
    let windowID: CGWindowID
    let label: String

    static func parse() throws -> Arguments {
        var pid: pid_t?
        var windowID: CGWindowID?
        var label = "Bimax Computer Use"
        var index = 1
        let args = CommandLine.arguments

        while index < args.count {
            let value = args[index]
            guard index + 1 < args.count else {
                throw PreviewError("missing value for \(value)")
            }
            switch value {
            case "--pid":
                guard let parsed = Int32(args[index + 1]), parsed > 0 else {
                    throw PreviewError("invalid --pid")
                }
                pid = parsed
            case "--window-id":
                guard let parsed = UInt32(args[index + 1]), parsed > 0 else {
                    throw PreviewError("invalid --window-id")
                }
                windowID = parsed
            case "--label":
                label = args[index + 1]
            default:
                throw PreviewError("unknown argument \(value)")
            }
            index += 2
        }

        guard let pid, let windowID else {
            throw PreviewError("usage: bimax-live-pip --pid PID --window-id ID [--label TEXT]")
        }
        return Arguments(pid: pid, windowID: windowID, label: label)
    }
}

private struct PreviewError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

@available(macOS 12.3, *)
private final class PreviewView: NSView {
    let displayLayer = AVSampleBufferDisplayLayer()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer = CALayer()
        layer?.backgroundColor = NSColor.clear.cgColor
        // Preserve the complete image. The panel itself adopts the source aspect ratio below, so
        // aspect-fit has neither letterboxing nor cropping.
        displayLayer.videoGravity = .resizeAspect
        displayLayer.backgroundColor = NSColor.clear.cgColor
        layer?.addSublayer(displayLayer)
        layer?.cornerRadius = 12
        layer?.masksToBounds = true
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func layout() {
        super.layout()
        displayLayer.frame = bounds
    }
}

@available(macOS 12.3, *)
private final class StreamOutput: NSObject, SCStreamOutput {
    weak var preview: PreviewView?
    private var frameCount = 0
    private var droppedStale = 0
    private var droppedNotReady = 0
    private var idleFrames = 0
    /// Set while a frame is in flight to the main queue. A second frame arriving before the first
    /// has rendered REPLACES it rather than queueing behind it: `DispatchQueue.main.async` is
    /// unbounded, so a busy main thread would otherwise build a backlog and the preview would fall
    /// progressively further behind live — the "frame age keeps growing" failure Apple warns about.
    private var pending: CMSampleBuffer?
    private var inFlight = false
    private let lock = NSLock()
    /// Capture→enqueue latency samples (seconds) for the current reporting window.
    private var latencies: [Double] = []
    private var windowStart = CFAbsoluteTimeGetCurrent()

    init(preview: PreviewView) {
        self.preview = preview
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .screen, sampleBuffer.isValid, CMSampleBufferDataIsReady(sampleBuffer) else {
            return
        }
        // ScreenCaptureKit delivers a frame per interval even when nothing changed; those carry
        // status .idle and must not be counted as delivered frames or as drops.
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
           let raw = attachments.first?[.status] as? Int,
           let status = SCFrameStatus(rawValue: raw), status != .complete {
            if status == .idle { idleFrames += 1 }
            return
        }

        lock.lock()
        if inFlight {
            // A frame is still on its way to the layer. Keep only the NEWEST — showing a backlog of
            // obsolete preview frames is strictly worse than dropping them.
            if pending != nil { droppedStale += 1 }
            pending = sampleBuffer
            lock.unlock()
            return
        }
        inFlight = true
        lock.unlock()
        deliver(sampleBuffer)
    }

    private func deliver(_ buffer: CMSampleBuffer) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.render(buffer)
            // Drain whatever arrived while this frame was in flight, newest only.
            self.lock.lock()
            let next = self.pending
            self.pending = nil
            if next == nil { self.inFlight = false }
            self.lock.unlock()
            if let next { self.deliver(next) }
        }
    }

    private func render(_ buffer: CMSampleBuffer) {
        guard let layer = preview?.displayLayer else { return }
        if layer.status == .failed { layer.flush() }
        guard layer.isReadyForMoreMediaData else {
            // The layer is not consuming (panel occluded or off-screen). Enqueuing anyway is what
            // builds an invisible backlog that surfaces as a latency spike when it becomes visible.
            droppedNotReady += 1
            return
        }
        // Host-clock delta: when the frame was captured vs when it reaches the layer. This is
        // glass-to-glass minus display scan-out, which is the part this process controls.
        let now = CMClockGetTime(CMClockGetHostTimeClock())
        let latency = now.seconds - buffer.presentationTimeStamp.seconds
        if latency.isFinite, latency >= 0, latency < 5 { latencies.append(latency) }
        layer.enqueue(buffer)
        frameCount += 1
        if frameCount == 1 {
            print("{\"event\":\"first_frame\"}")
            fflush(stdout)
        }
        reportIfDue()
    }

    /// Emit measured throughput/latency once a second. Without this the PiP could only be described
    /// as "real-time" by assertion; these are the numbers that make the claim checkable.
    private func reportIfDue() {
        let now = CFAbsoluteTimeGetCurrent()
        let elapsed = now - windowStart
        guard elapsed >= 1.0 else { return }
        let sorted = latencies.sorted()
        let pick = { (q: Double) -> Double in
            sorted.isEmpty ? 0 : sorted[min(sorted.count - 1, Int(Double(sorted.count - 1) * q))]
        }
        let fps = Double(sorted.count) / elapsed
        print("{\"event\":\"pip_stats\",\"fps\":\(String(format: "%.1f", fps))"
            + ",\"latency_ms_p50\":\(Int(pick(0.5) * 1000)),\"latency_ms_p95\":\(Int(pick(0.95) * 1000))"
            + ",\"frames\":\(frameCount),\"dropped_stale\":\(droppedStale)"
            + ",\"dropped_not_ready\":\(droppedNotReady),\"idle\":\(idleFrames)}")
        fflush(stdout)
        latencies.removeAll(keepingCapacity: true)
        windowStart = now
    }
}

@available(macOS 12.3, *)
private final class PreviewApplication: NSObject, NSApplicationDelegate, NSWindowDelegate, SCStreamDelegate {
    private let arguments: Arguments
    private let captureQueue = DispatchQueue(label: "ai.bimax.live-pip.capture", qos: .userInteractive)
    private var panel: NSPanel?
    private var stream: SCStream?
    private var output: StreamOutput?
    private var terminating = false
    private var signalSources: [DispatchSourceSignal] = []

    init(arguments: Arguments) {
        self.arguments = arguments
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installSignalHandlers()
        buildWindow()
        Task { @MainActor in
            do {
                try await startCapture()
            } catch {
                fail(error.localizedDescription)
            }
        }
    }

    private func buildWindow() {
        let preview = PreviewView(frame: NSRect(x: 0, y: 0, width: 480, height: 320))
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 480, height: 320))
        container.wantsLayer = true
        container.layer?.cornerRadius = 12
        container.layer?.masksToBounds = true
        preview.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(preview)
        NSLayoutConstraint.activate([
            preview.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            preview.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            preview.topAnchor.constraint(equalTo: container.topAnchor),
            preview.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 320),
            styleMask: [.borderless, .resizable, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.title = "Bimax Live Preview · \(arguments.label)"
        panel.contentView = container
        panel.contentMinSize = NSSize(width: 240, height: 160)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.delegate = self

        if let screen = NSScreen.main {
            let visible = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(
                x: visible.maxX - panel.frame.width - 18,
                y: visible.maxY - panel.frame.height - 18
            ))
        } else {
            panel.center()
        }
        panel.orderFrontRegardless()
        self.panel = panel
        self.output = StreamOutput(preview: preview)
        listenForCommands()
    }

    /**
     * Minimal stdin control channel: `avoid <x> <y> <w> <h>` (global points, top-left origin).
     *
     * This panel floats above every application window and accepts mouse events, so a synthesized
     * click landing inside it is delivered HERE instead of to the app being driven — measured live,
     * a click at the panel's centre was received by this process while a point 40pt to its left
     * reached the target app. Raising the target cannot fix that (Apple documents floating windows
     * as staying above kAXRaiseAction), so the runtime asks the panel to step aside instead.
     *
     * The rectangle to avoid arrives in the runtime's top-left coordinate space; the flip to
     * AppKit's bottom-left origin is done HERE, next to the NSScreen that defines it, rather than
     * in the caller.
     */
    private func listenForCommands() {
        let handle = FileHandle.standardInput
        DispatchQueue.global(qos: .utility).async {
            while let line = readLine(strippingNewline: true) {
                let parts = line.split(separator: " ").map(String.init)
                guard parts.count == 5, parts[0] == "avoid",
                      let x = Double(parts[1]), let y = Double(parts[2]),
                      let w = Double(parts[3]), let h = Double(parts[4]) else { continue }
                DispatchQueue.main.async { self.stepAside(from: CGRect(x: x, y: y, width: w, height: h)) }
            }
            _ = handle
        }
    }

    /** Park the panel in whichever corner of the visible area is furthest from `blocked`. */
    private func stepAside(from blocked: CGRect) {
        guard let panel = self.panel, let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let flippedTop = screen.frame.maxY - (blocked.origin.y + blocked.height)
        let avoid = CGRect(x: blocked.origin.x, y: flippedTop, width: blocked.width, height: blocked.height)
        let size = panel.frame.size
        let inset: CGFloat = 18
        let corners = [
            CGPoint(x: visible.maxX - size.width - inset, y: visible.maxY - size.height - inset),
            CGPoint(x: visible.minX + inset, y: visible.maxY - size.height - inset),
            CGPoint(x: visible.maxX - size.width - inset, y: visible.minY + inset),
            CGPoint(x: visible.minX + inset, y: visible.minY + inset),
        ]
        // Prefer a corner with no overlap at all; otherwise the least-overlapping one, so the panel
        // still moves on a screen too small for any clear corner.
        let best = corners.min { a, b in
            let ra = CGRect(origin: a, size: size).intersection(avoid)
            let rb = CGRect(origin: b, size: size).intersection(avoid)
            return (ra.isNull ? 0 : ra.width * ra.height) < (rb.isNull ? 0 : rb.width * rb.height)
        }
        if let best { panel.setFrameOrigin(best) }
    }

    private func startCapture() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: false
        )
        guard let target = content.windows.first(where: {
            $0.windowID == arguments.windowID
                && $0.owningApplication?.processID == arguments.pid
        }) else {
            throw PreviewError(
                "target window \(arguments.windowID) for pid \(arguments.pid) is unavailable"
            )
        }
        guard let output else {
            throw PreviewError("preview output was not initialized")
        }

        // SCShareableContent resumes on a cooperative queue. AppKit window mutations must return
        // to the main actor explicitly or NSWindow's transaction coordinator traps.
        await MainActor.run { self.fitPanel(to: target.frame.size) }

        // PiP is the operator's clean app preview, not the model's desktop safety frame. Keep the
        // exact target window visible even while another application remains frontmost.
        let filter = SCContentFilter(desktopIndependentWindow: target)
        let configuration = SCStreamConfiguration()
        let scale: CGFloat = 2
        configuration.width = max(1, min(2560, Int(target.frame.width * scale)))
        configuration.height = max(1, min(1600, Int(target.frame.height * scale)))
        // minimumFrameInterval is a CEILING on delivery rate, and 15fps made the preview visibly
        // choppy — it was the reason PiP did not read as live. ScreenCaptureKit only produces a
        // complete frame when the content actually changes (unchanged intervals arrive as .idle and
        // are discarded above), so raising this costs nothing on a static window while allowing a
        // genuinely smooth 60fps during animation.
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 60)
        // Apple documents 3-8; 3 is the minimum and therefore the lowest-latency choice. The output
        // handler keeps only the newest frame, so a deeper queue would buy buffering we discard.
        configuration.queueDepth = 3
        configuration.showsCursor = true
        configuration.pixelFormat = kCVPixelFormatType_32BGRA

        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: captureQueue)
        self.stream = stream
        try await stream.startCapture()
        print("{\"event\":\"stream_started\",\"pid\":\(arguments.pid),\"window_id\":\(arguments.windowID)}")
        fflush(stdout)
    }

    /**
     * Match the floating panel to the captured window instead of forcing every source into the
     * original 3:2 rectangle. This removes side/top letterboxing while keeping `.resizeAspect`, so
     * the operator sees the complete window and no pixels are cropped. `contentAspectRatio` keeps
     * the match when the user resizes the PiP manually.
     *
     * PiP is presentation-only: ComputerTool coordinates remain bound to its separate exact action
     * screenshot and FrameRegistry, so changing this panel geometry cannot change click delivery.
     */
    @MainActor private func fitPanel(to source: CGSize) {
        guard let panel, source.width > 0, source.height > 0 else { return }
        let visible = (panel.screen ?? NSScreen.main)?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let maxSize = CGSize(
            width: min(480, visible.width * 0.45),
            height: min(480, visible.height * 0.55)
        )
        let scale = min(maxSize.width / source.width, maxSize.height / source.height)
        let preferred = CGSize(
            width: max(1, floor(source.width * scale)),
            height: max(1, floor(source.height * scale))
        )
        // Keep the minimum on the same ratio too; an arbitrary 240×160 minimum would reintroduce
        // bars for a narrow or wide source when the panel is resized down.
        let minimumScale = min(1, 200 / max(source.width, source.height))
        panel.contentMinSize = CGSize(
            width: max(1, floor(source.width * minimumScale)),
            height: max(1, floor(source.height * minimumScale))
        )
        panel.contentAspectRatio = source
        panel.setContentSize(preferred)
        panel.setFrameOrigin(NSPoint(
            x: visible.maxX - panel.frame.width - 18,
            y: visible.maxY - panel.frame.height - 18
        ))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        guard !terminating else { return }
        fail("ScreenCaptureKit stopped: \(error.localizedDescription)")
    }

    func windowWillClose(_ notification: Notification) {
        terminate()
    }

    private func installSignalHandlers() {
        for signalNumber in [SIGINT, SIGTERM] {
            signal(signalNumber, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
            source.setEventHandler { [weak self] in self?.terminate() }
            source.resume()
            signalSources.append(source)
        }
    }

    private func fail(_ message: String) {
        FileHandle.standardError.write(("bimax-live-pip: \(message)\n").data(using: .utf8)!)
        terminate(exitCode: 2)
    }

    private func terminate(exitCode: Int32 = 0) {
        guard !terminating else { return }
        terminating = true
        let runningStream = stream
        stream = nil
        Task { @MainActor in
            if let runningStream {
                try? await runningStream.stopCapture()
            }
            NSApp.terminate(nil)
            exit(exitCode)
        }
    }
}

@main
private struct BimaxLivePip {
    static func main() {
        do {
            let arguments = try Arguments.parse()
            guard #available(macOS 12.3, *) else {
                throw PreviewError("continuous PiP requires macOS 12.3 or newer")
            }
            let application = NSApplication.shared
            let delegate = PreviewApplication(arguments: arguments)
            application.setActivationPolicy(.accessory)
            application.delegate = delegate
            withExtendedLifetime(delegate) {
                application.run()
            }
        } catch {
            FileHandle.standardError.write(
                ("bimax-live-pip: \(error.localizedDescription)\n").data(using: .utf8)!
            )
            exit(2)
        }
    }
}
