import ApplicationServices
import CoreGraphics
import Foundation
import Security
import BimaxCuProtocol

public protocol PermissionStateProviding: Sendable {
    func current() -> PermissionState
}

public struct PermissionDoctor: PermissionStateProviding {
    public init() {}

    public func current() -> PermissionState {
        let accessibility: PermissionDisposition = AXIsProcessTrusted() ? .granted : .denied
        let screenGranted = CGPreflightScreenCaptureAccess()
        let signing = Self.cachedSigningIdentity()
        return PermissionState(
            accessibility: accessibility,
            screenRecording: screenGranted ? .granted : .denied,
            screenCapturable: screenGranted,
            inputMonitoring: .notRequired,
            serviceSigned: signing.identifier != nil && !signing.adHoc,
            signingIdentifier: signing.identifier,
            adHocSigned: signing.adHoc,
            signatureIntact: signing.intact,
            codeDirectoryHash: signing.cdHash
        )
    }

    /// The running process's own signing identity cannot change while it runs, and
    /// `SecStaticCodeCheckValidity` re-hashes every page of the binary — so this is computed once
    /// rather than on every handshake.
    private static let cached: SigningIdentity = signingIdentity()

    private static func cachedSigningIdentity() -> SigningIdentity { cached }

    struct SigningIdentity {
        var identifier: String?
        var team: String?
        var adHoc: Bool
        /// The seal verifies: every page still hashes to what the signature recorded. TRUE for a
        /// valid ad-hoc signature too — ad-hoc says nothing about *who* sealed it, but a passing
        /// check still proves the bytes have not been altered since it was sealed.
        var intact: Bool
        /// The code directory hash: the content-addressed identity of exactly these bytes. This is
        /// what an approval is recorded against, so modifying the binary invalidates the approval.
        var cdHash: String?
    }

    private static func signingIdentity() -> SigningIdentity {
        let none = SigningIdentity(identifier: nil, team: nil, adHoc: false, intact: false, cdHash: nil)
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return none }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess,
              let staticCode else { return none }
        var raw: CFDictionary?
        let flags = SecCSFlags(rawValue: kSecCSSigningInformation)
        guard SecCodeCopySigningInformation(staticCode, flags, &raw) == errSecSuccess,
              let info = raw as? [String: Any] else { return none }
        let signingFlags = (info[kSecCodeInfoFlags as String] as? NSNumber)?.uint32Value ?? 0
        // Verify the seal rather than merely reading the identity it claims. Without this the state
        // reported only WHO signed, never whether the signature still covers the bytes on disk, so a
        // tampered binary and an untouched one were indistinguishable here.
        let intact = SecStaticCodeCheckValidity(staticCode, [], nil) == errSecSuccess
        let cdHash = (info[kSecCodeInfoUnique as String] as? Data)
            .map { $0.map { byte in String(format: "%02x", byte) }.joined() }
        return SigningIdentity(
            identifier: info[kSecCodeInfoIdentifier as String] as? String,
            team: info[kSecCodeInfoTeamIdentifier as String] as? String,
            // Security's kSecCodeSignatureAdhoc (0x0002) is not imported by this Swift SDK.
            adHoc: signingFlags & 0x0002 != 0,
            intact: intact,
            cdHash: cdHash
        )
    }
}
