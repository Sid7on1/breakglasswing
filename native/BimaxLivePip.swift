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
        layer?.backgroundColor = NSColor.black.cgColor
        displayLayer.videoGravity = .resizeAspect
        displayLayer.backgroundColor = NSColor.black.cgColor
        layer?.addSublayer(displayLayer)
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
        DispatchQueue.main.async { [weak self] in
            guard let self, let layer = self.preview?.displayLayer else { return }
            if layer.status == .failed {
                layer.flush()
            }
            layer.enqueue(sampleBuffer)
            self.frameCount += 1
            if self.frameCount == 1 {
                print("{\"event\":\"first_frame\"}")
                fflush(stdout)
            } else if self.frameCount % 15 == 0 {
                print("{\"event\":\"frame_progress\",\"frames\":\(self.frameCount)}")
                fflush(stdout)
            }
        }
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
        let label = NSTextField(labelWithString: "LIVE  \(arguments.label)")
        label.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .semibold)
        label.textColor = .secondaryLabelColor
        label.lineBreakMode = .byTruncatingMiddle
        label.maximumNumberOfLines = 1

        let container = NSView(frame: NSRect(x: 0, y: 0, width: 480, height: 346))
        preview.translatesAutoresizingMaskIntoConstraints = false
        label.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(preview)
        container.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 10),
            label.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -10),
            label.topAnchor.constraint(equalTo: container.topAnchor, constant: 6),
            label.heightAnchor.constraint(equalToConstant: 16),
            preview.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            preview.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            preview.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 4),
            preview.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 346),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.title = "Bimax Live Preview"
        panel.contentView = container
        panel.contentMinSize = NSSize(width: 280, height: 200)
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

        let filter = SCContentFilter(desktopIndependentWindow: target)
        let configuration = SCStreamConfiguration()
        let scale: CGFloat = 2
        configuration.width = max(1, min(2560, Int(target.frame.width * scale)))
        configuration.height = max(1, min(1600, Int(target.frame.height * scale)))
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 15)
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
