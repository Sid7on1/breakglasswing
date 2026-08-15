// Swift translation of MacOS-Use at c88574c0a70534a21e9490e2118f1fce04e16904,
// macos_use/agent/desktop/service.py:get_annotated_screenshot.
// Copyright (c) 2025 CursorTouch. MIT; see THIRD_PARTY_NOTICES.md.

import CoreGraphics
import CoreText
import Foundation
import BimaxCuProtocol

public struct SOMElement: Equatable, Sendable {
    public var index: Int
    /// Source-image pixels, top-left origin.
    public var bounds: CuRect

    public init(index: Int, bounds: CuRect) {
        self.index = index
        self.bounds = bounds
    }
}

public struct SOMColor: Equatable, Sendable {
    public var red: Double
    public var green: Double
    public var blue: Double

    public init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }
}

public struct SOMAnnotation: Equatable, Sendable {
    public var index: Int
    /// Annotated-output pixels, top-left origin.
    public var bounds: CuRect
    public var tagBounds: CuRect
    public var color: SOMColor

    public init(index: Int, bounds: CuRect, tagBounds: CuRect, color: SOMColor) {
        self.index = index
        self.bounds = bounds
        self.tagBounds = tagBounds
        self.color = color
    }
}

public struct SOMRenderedImage: @unchecked Sendable {
    public var image: CGImage
    public var annotations: [SOMAnnotation]
    /// Where the unmodified source pixels sit inside the annotated image.
    public var sourceContentRect: CuRect

    public init(image: CGImage, annotations: [SOMAnnotation], sourceContentRect: CuRect) {
        self.image = image
        self.annotations = annotations
        self.sourceContentRect = sourceContentRect
    }
}

public enum SOMRendererError: Error, Equatable, Sendable {
    case invalidImage
    case renderFailed
}

public final class SOMRenderer: Sendable {
    public init() {}

    public func render(
        source: CGImage,
        elements: [SOMElement],
        displayScale: Double = 1,
        padding: Int = 5
    ) throws -> SOMRenderedImage {
        guard source.width > 0, source.height > 0, displayScale > 0, padding >= 0 else {
            throw SOMRendererError.invalidImage
        }
        // Preserve MacOS-Use's 1.5× padding canvas and paste offset exactly.
        let outputWidth = Int(Double(source.width) + 1.5 * Double(padding))
        let outputHeight = Int(Double(source.height) + 1.5 * Double(padding))
        guard outputWidth > 0, outputHeight > 0,
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(
                data: nil, width: outputWidth, height: outputHeight,
                bitsPerComponent: 8, bytesPerRow: outputWidth * 4, space: colorSpace,
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
                    .union(.byteOrder32Big).rawValue
              ) else {
            throw SOMRendererError.renderFailed
        }

        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: outputWidth, height: outputHeight))
        let sourceContentRect = CuRect(
            x: Double(padding), y: Double(padding),
            width: Double(source.width), height: Double(source.height)
        )
        context.draw(source, in: quartzRect(sourceContentRect, outputHeight: outputHeight))

        let fontSize = max(12, 14 * displayScale)
        let font = CTFontCreateWithName("Helvetica" as CFString, fontSize, nil)
        var seen = Set<RectKey>()
        var annotations: [SOMAnnotation] = []

        for element in elements {
            guard element.bounds.width > 0, element.bounds.height > 0 else { continue }
            let clipped = clip(element.bounds, width: source.width, height: source.height)
            guard clipped.width > 0, clipped.height > 0 else { continue }
            let key = RectKey(clipped)
            guard seen.insert(key).inserted else { continue }

            let color = Self.color(for: element.index)
            let cgColor = CGColor(red: color.red, green: color.green, blue: color.blue, alpha: 1)
            let outputBounds = CuRect(
                x: clipped.x + Double(padding),
                y: clipped.y + Double(padding),
                width: clipped.width,
                height: clipped.height
            )
            context.setStrokeColor(cgColor)
            context.setLineWidth(2)
            context.stroke(quartzRect(outputBounds, outputHeight: outputHeight))

            let text = String(element.index)
            let attributes: [NSAttributedString.Key: Any] = [
                NSAttributedString.Key(kCTFontAttributeName as String): font,
                NSAttributedString.Key(kCTForegroundColorAttributeName as String):
                    CGColor(red: 1, green: 1, blue: 1, alpha: 1),
            ]
            let line = CTLineCreateWithAttributedString(NSAttributedString(
                string: text,
                attributes: attributes
            ))
            var ascent: CGFloat = 0
            var descent: CGFloat = 0
            var leading: CGFloat = 0
            let textWidth = CTLineGetTypographicBounds(line, &ascent, &descent, &leading)
            let textHeight = ceil(ascent + descent + leading)
            let tagX = outputBounds.x + outputBounds.width - textWidth - 4
            var tagY = outputBounds.y - textHeight - 4
            if tagY < Double(padding) { tagY = outputBounds.y + outputBounds.height }
            let tag = CuRect(
                x: tagX, y: tagY,
                width: textWidth + 4, height: textHeight + 4
            )
            context.setFillColor(cgColor)
            context.fill(quartzRect(tag, outputHeight: outputHeight))
            context.textPosition = CGPoint(
                x: tag.x + 2,
                y: Double(outputHeight) - tag.y - tag.height + 2 + descent
            )
            CTLineDraw(line, context)
            annotations.append(.init(
                index: element.index,
                bounds: outputBounds,
                tagBounds: tag,
                color: color
            ))
        }

        guard let image = context.makeImage() else { throw SOMRendererError.renderFailed }
        return SOMRenderedImage(
            image: image,
            annotations: annotations,
            sourceContentRect: sourceContentRect
        )
    }

    private struct RectKey: Hashable {
        var x: UInt64
        var y: UInt64
        var width: UInt64
        var height: UInt64

        init(_ rect: CuRect) {
            x = rect.x.bitPattern
            y = rect.y.bitPattern
            width = rect.width.bitPattern
            height = rect.height.bitPattern
        }
    }

    private static func color(for index: Int) -> SOMColor {
        // MacOS-Use seeds its random generator with the label. A fixed LCG gives Swift the same
        // required property—stable, per-label colors—without process-random hash seeding.
        var state = UInt64(bitPattern: Int64(index)) &+ 0x9e3779b97f4a7c15
        func component() -> Double {
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return Double(50 + Int((state >> 32) % 206)) / 255
        }
        return SOMColor(red: component(), green: component(), blue: component())
    }

    private func clip(_ rect: CuRect, width: Int, height: Int) -> CuRect {
        let left = max(0, rect.x)
        let top = max(0, rect.y)
        let right = min(Double(width), rect.x + rect.width)
        let bottom = min(Double(height), rect.y + rect.height)
        return CuRect(
            x: left, y: top,
            width: max(0, right - left),
            height: max(0, bottom - top)
        )
    }

    private func quartzRect(_ rect: CuRect, outputHeight: Int) -> CGRect {
        CGRect(
            x: rect.x,
            y: Double(outputHeight) - rect.y - rect.height,
            width: rect.width,
            height: rect.height
        )
    }
}
