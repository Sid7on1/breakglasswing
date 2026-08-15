import CoreGraphics
import Foundation
import BimaxCuProtocol

public protocol CaptureServicing: Sendable {
    func capture(sessionId: String, request: CaptureImageRequest) throws -> EncodedCaptureImage
    func reset(sessionId: String)
}

public enum CaptureServiceError: Error, Equatable, Sendable {
    case permissionDenied
    case targetUnavailable
    case timedOut
    case noFrame
    case invalidRequest
}

private final class CaptureAsyncBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<Value, Error>?
    func set(_ result: Result<Value, Error>) { lock.withLock { self.result = result } }
    func get() -> Result<Value, Error>? { lock.withLock { result } }
}

/// One-shot image capture backed by the bounded stream pool.
///
/// The stream is always reset before this call returns. Continuous/warm stream ownership remains a
/// separate capability and is not implied by accepting a still-image request.
public final class ScreenCaptureService: CaptureServicing, @unchecked Sendable {
    public init() {}

    public func capture(sessionId: String, request: CaptureImageRequest) throws -> EncodedCaptureImage {
        guard !sessionId.isEmpty else { throw CaptureServiceError.invalidRequest }
        guard #available(macOS 12.3, *) else { throw CaptureServiceError.targetUnavailable }
        guard CGPreflightScreenCaptureAccess() else { throw CaptureServiceError.permissionDenied }
        return try waitForAsync(timeoutSeconds: 8) { try await Self.captureAsync(request) }
    }

    public func reset(sessionId: String) {}

    @available(macOS 12.3, *)
    private static func captureAsync(_ request: CaptureImageRequest) async throws -> EncodedCaptureImage {
        let driver = await MainActor.run { ScreenCaptureKitStreamDriver() }
        let pool = try CaptureStreamPool(maxStreams: 1, driver: driver)
        let target: CaptureStreamTarget
        switch request.target {
        case .window(let window): target = .window(pid: window.pid, windowId: window.windowId)
        case .display(let displayId): target = .display(displayId: displayId)
        }
        let lease: CaptureStreamLease
        do {
            lease = try await pool.acquire(target: target)
        } catch ScreenCaptureKitStreamError.targetUnavailable {
            throw CaptureServiceError.targetUnavailable
        }
        defer { Task { await pool.reset() } }

        let deadline = Date().timeIntervalSinceReferenceDate + 5
        while Date().timeIntervalSinceReferenceDate < deadline {
            if let stats = try await pool.stats(for: lease), stats.completeFrames > 0 {
                let encoded = try await pool.image(for: lease, request: CaptureEncodingRequest(
                    format: request.format == .png ? .png : .jpeg,
                    maxDimension: request.maxDimension,
                    jpegQuality: request.jpegQuality,
                    scaleFactor: request.zoomFactor,
                    sourcePixelRect: request.region
                ))
                try await pool.release(lease)
                await pool.reset()
                guard let encoded else { throw CaptureServiceError.noFrame }
                return encoded
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        try await pool.release(lease)
        await pool.reset()
        if #available(macOS 14.0, *) {
            do {
                return try await driver.stillImage(target: target, request: CaptureEncodingRequest(
                    format: request.format == .png ? .png : .jpeg,
                    maxDimension: request.maxDimension,
                    jpegQuality: request.jpegQuality,
                    scaleFactor: request.zoomFactor,
                    sourcePixelRect: request.region
                ))
            } catch {
                // Preserve the public no-frame contract. The live conformance report records the
                // suspended stream separately; callers should not receive an implementation detail
                // in place of the typed capture error.
            }
        }
        throw CaptureServiceError.noFrame
    }

    private func waitForAsync<Value: Sendable>(
        timeoutSeconds: Double,
        operation: @escaping @Sendable () async throws -> Value
    ) throws -> Value {
        guard #available(macOS 12.3, *) else { throw CaptureServiceError.targetUnavailable }
        let box = CaptureAsyncBox<Value>()
        let semaphore = DispatchSemaphore(value: 0)
        Task.detached {
            do { box.set(.success(try await operation())) }
            catch { box.set(.failure(error)) }
            semaphore.signal()
        }
        let deadline = Date().addingTimeInterval(timeoutSeconds)
        if Thread.isMainThread {
            while box.get() == nil, Date() < deadline {
                RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
            }
        } else if semaphore.wait(timeout: .now() + timeoutSeconds) != .success {
            throw CaptureServiceError.timedOut
        }
        guard let result = box.get() else { throw CaptureServiceError.timedOut }
        return try result.get()
    }
}
