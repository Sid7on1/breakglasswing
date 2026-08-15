import Foundation
import BimaxCuProtocol

public enum SessionRegistryError: Error, Equatable {
    case invalidId
    case alreadyExists
    case notFound
    case capacityReached
}

public final class SessionRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var sessions: [String: SessionInfo] = [:]
    private var nextGeneration: UInt64 = 1
    private let capacity: Int

    public init(capacity: Int = 32) { self.capacity = max(1, capacity) }

    public func create(requestedId: String?) throws -> SessionInfo {
        try lock.withLock {
            guard sessions.count < capacity else { throw SessionRegistryError.capacityReached }
            let id = requestedId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                ? requestedId!.trimmingCharacters(in: .whitespacesAndNewlines)
                : "bimax-cu-\(UUID().uuidString.lowercased())"
            guard Self.valid(id) else { throw SessionRegistryError.invalidId }
            guard sessions[id] == nil else { throw SessionRegistryError.alreadyExists }
            let info = SessionInfo(
                sessionId: id,
                generation: nextGeneration,
                createdAtMs: Int64(Date().timeIntervalSince1970 * 1_000)
            )
            nextGeneration += 1
            sessions[id] = info
            return info
        }
    }

    public func status(_ id: String) throws -> SessionInfo {
        try lock.withLock {
            guard let info = sessions[id] else { throw SessionRegistryError.notFound }
            return info
        }
    }

    public func reset(_ id: String) throws -> SessionInfo {
        try lock.withLock {
            guard var info = sessions[id] else { throw SessionRegistryError.notFound }
            info.generation = nextGeneration
            info.targetRevision = 0
            nextGeneration += 1
            sessions[id] = info
            return info
        }
    }

    public func close(_ id: String) throws {
        try lock.withLock {
            guard sessions.removeValue(forKey: id) != nil else { throw SessionRegistryError.notFound }
        }
    }

    public var count: Int { lock.withLock { sessions.count } }

    private static func valid(_ id: String) -> Bool {
        guard (1...96).contains(id.utf8.count) else { return false }
        return id.unicodeScalars.allSatisfy { scalar in
            CharacterSet.alphanumerics.contains(scalar) || "._-".unicodeScalars.contains(scalar)
        }
    }
}
