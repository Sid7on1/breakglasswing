// Adapted from MacOS-Use at c88574c0a70534a21e9490e2118f1fce04e16904:
// macos_use/ax/core.py (GetPerDisplayInfo) and
// macos_use/agent/desktop/service.py (logical-to-pixel annotation mapping).
// Copyright (c) 2025 CursorTouch. Licensed under MIT; see THIRD_PARTY_NOTICES.md.

import Foundation
import BimaxCuProtocol

/// A rectangle expressed in pixels local to one display capture.
///
/// ScreenCaptureKit captures a display independently, so a region never relies on one global
/// Retina scale or on an assumed left-to-right stitched desktop image.
public struct CapturePixelRegion: Equatable, Sendable {
    public var displayId: UInt32
    public var rect: CuRect

    public init(displayId: UInt32, rect: CuRect) {
        self.displayId = displayId
        self.rect = rect
    }
}

/// Maps global macOS logical points into exact display-local capture pixels.
///
/// MacOS-Use's annotation path selects the display containing each logical point and applies that
/// display's scale. This translation keeps that behavior but returns one segment per intersected
/// display, which preserves rectangles crossing mixed-DPI display boundaries.
public struct CaptureGeometry: Sendable {
    private struct Transform: Sendable {
        let displayId: UInt32
        let logical: CuRect
        let scaleX: Double
        let scaleY: Double

        init?(_ display: DisplayInfo) {
            guard display.bounds.width > 0, display.bounds.height > 0,
                  display.pixelWidth > 0, display.pixelHeight > 0 else { return nil }
            displayId = display.displayId
            logical = display.bounds
            scaleX = Double(display.pixelWidth) / display.bounds.width
            scaleY = Double(display.pixelHeight) / display.bounds.height
        }

        func contains(x: Double, y: Double) -> Bool {
            x >= logical.x && x < logical.x + logical.width
                && y >= logical.y && y < logical.y + logical.height
        }

        func pixelPoint(x: Double, y: Double) -> CuRect {
            CuRect(
                x: (x - logical.x) * scaleX,
                y: (y - logical.y) * scaleY,
                width: 0,
                height: 0
            )
        }

        func pixelIntersection(_ global: CuRect) -> CapturePixelRegion? {
            let left = max(global.x, logical.x)
            let top = max(global.y, logical.y)
            let right = min(global.x + global.width, logical.x + logical.width)
            let bottom = min(global.y + global.height, logical.y + logical.height)
            guard right > left, bottom > top else { return nil }
            return CapturePixelRegion(
                displayId: displayId,
                rect: CuRect(
                    x: (left - logical.x) * scaleX,
                    y: (top - logical.y) * scaleY,
                    width: (right - left) * scaleX,
                    height: (bottom - top) * scaleY
                )
            )
        }
    }

    private let transforms: [Transform]

    public init(displays: [DisplayInfo]) {
        transforms = displays.compactMap(Transform.init).sorted {
            if $0.logical.x != $1.logical.x { return $0.logical.x < $1.logical.x }
            if $0.logical.y != $1.logical.y { return $0.logical.y < $1.logical.y }
            return $0.displayId < $1.displayId
        }
    }

    /// Returns a zero-sized pixel rect carrying the mapped point, or nil outside every display.
    public func pixelPoint(x: Double, y: Double) -> CapturePixelRegion? {
        guard let transform = transforms.first(where: { $0.contains(x: x, y: y) }) else {
            return nil
        }
        return CapturePixelRegion(displayId: transform.displayId, rect: transform.pixelPoint(x: x, y: y))
    }

    /// Clips a global logical rectangle to every display it intersects.
    public func pixelRegions(for global: CuRect) -> [CapturePixelRegion] {
        guard global.width > 0, global.height > 0 else { return [] }
        return transforms.compactMap { $0.pixelIntersection(global) }
    }
}
