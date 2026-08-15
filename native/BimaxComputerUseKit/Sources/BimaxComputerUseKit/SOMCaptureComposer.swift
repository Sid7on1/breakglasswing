import CoreGraphics
import Foundation
import ImageIO
import BimaxCuProtocol

public struct SOMCaptureComposition: Equatable, Sendable {
    public var encoded: EncodedCaptureImage
    public var marks: [SOMMarkRef]
    public var sourceContentRect: CuRect

    public init(encoded: EncodedCaptureImage, marks: [SOMMarkRef], sourceContentRect: CuRect) {
        self.encoded = encoded
        self.marks = marks
        self.sourceContentRect = sourceContentRect
    }
}

public enum SOMCaptureComposerError: Error, Equatable, Sendable {
    case invalidSourceImage
    case invalidWindowBounds
    case encodeFailed
}

/// Binds every visible SOM label to an ElementRef from one authoritative retained AX snapshot.
public final class SOMCaptureComposer: Sendable {
    private let renderer: SOMRenderer

    public init(renderer: SOMRenderer = SOMRenderer()) {
        self.renderer = renderer
    }

    public func compose(
        source: EncodedCaptureImage,
        windowBounds: CuRect,
        snapshot: AXSnapshot,
        format: CaptureWireFormat,
        maxDimension: Int,
        jpegQuality: Double
    ) throws -> SOMCaptureComposition {
        guard valid(windowBounds),
              let imageSource = CGImageSourceCreateWithData(source.bytes as CFData, nil),
              let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil),
              image.width == source.pixelWidth,
              image.height == source.pixelHeight else {
            throw valid(windowBounds)
                ? SOMCaptureComposerError.invalidSourceImage
                : SOMCaptureComposerError.invalidWindowBounds
        }

        let scaleX = Double(image.width) / windowBounds.width
        let scaleY = Double(image.height) / windowBounds.height
        let candidates = snapshot.nodes
            .filter(Self.isActionable)
            .sorted {
                $0.order == $1.order
                    ? $0.stablePathHash < $1.stablePathHash
                    : $0.order < $1.order
            }

        var refs: [Int: ElementRef] = [:]
        let elements: [SOMElement] = candidates.enumerated().compactMap { index, node in
            guard let bounds = node.bounds, valid(bounds), let element = node.elementRef else {
                return nil
            }
            refs[index] = element
            return SOMElement(index: index, bounds: CuRect(
                x: (bounds.x - windowBounds.x) * scaleX,
                y: (bounds.y - windowBounds.y) * scaleY,
                width: bounds.width * scaleX,
                height: bounds.height * scaleY
            ))
        }

        let rendered = try renderer.render(source: image, elements: elements)
        let encoder = try CaptureImageEncoder()
        let encoded: EncodedCaptureImage
        do {
            encoded = try encoder.encode(rendered.image, request: .init(
                format: format == .png ? .png : .jpeg,
                maxDimension: maxDimension,
                jpegQuality: jpegQuality
            ))
        } catch {
            throw SOMCaptureComposerError.encodeFailed
        }

        let outputScaleX = Double(encoded.pixelWidth) / Double(rendered.image.width)
        let outputScaleY = Double(encoded.pixelHeight) / Double(rendered.image.height)
        let marks = rendered.annotations.compactMap { annotation -> SOMMarkRef? in
            guard let element = refs[annotation.index] else { return nil }
            return SOMMarkRef(
                index: annotation.index,
                element: element,
                bounds: scaled(annotation.bounds, x: outputScaleX, y: outputScaleY)
            )
        }
        return SOMCaptureComposition(
            encoded: encoded,
            marks: marks,
            sourceContentRect: scaled(rendered.sourceContentRect, x: outputScaleX, y: outputScaleY)
        )
    }

    private static func isActionable(_ node: AXNode) -> Bool {
        node.enabled && node.elementRef != nil && node.bounds != nil
            && (!node.actions.isEmpty || !node.settableAttributes.isEmpty || !node.patterns.isEmpty)
    }

    private func valid(_ rect: CuRect) -> Bool {
        rect.x.isFinite && rect.y.isFinite && rect.width.isFinite && rect.height.isFinite
            && rect.width > 0 && rect.height > 0
    }

    private func scaled(_ rect: CuRect, x: Double, y: Double) -> CuRect {
        CuRect(
            x: rect.x * x,
            y: rect.y * y,
            width: rect.width * x,
            height: rect.height * y
        )
    }
}
