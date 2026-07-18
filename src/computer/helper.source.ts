/**
 * Embedded Swift source for the macOS desktop-control helper.
 *
 * BiMax's engine is a bun-compiled Node binary: it cannot post CGEvents itself, and we refuse to
 * ship an opaque third-party binary for something this security-sensitive. Instead this ~200-line
 * Swift file IS the desktop driver — auditable in-repo, compiled ONCE on the user's machine with
 * the system `swiftc` (Xcode CLT), cached under ~/.bimax/native keyed by a hash of this source.
 * No MCP server, no npm postinstall, no network fetch: the only thing that ever runs is code that
 * shipped inside BiMax and was built locally.
 *
 * Protocol: single-shot CLI, one command per invocation, JSON on stdout. Coordinates are GLOBAL
 * SCREEN POINTS (CoreGraphics space, origin top-left of the main display) — the TS runtime keeps
 * screenshots in the same space so the model never has to reason about Retina pixel doubling.
 */

export const DESKTOP_HELPER_SOURCE = `
import AppKit
import CoreGraphics
import Foundation

func die(_ message: String) -> Never {
  FileHandle.standardError.write(("error: " + message + "\\n").data(using: .utf8)!)
  exit(2)
}

func jstr(_ s: String) -> String {
  var out = "\\""
  for c in s.unicodeScalars {
    switch c {
    case "\\"": out += "\\\\\\""
    case "\\\\": out += "\\\\\\\\"
    case "\\n": out += "\\\\n"
    case "\\r": out += "\\\\r"
    case "\\t": out += "\\\\t"
    default:
      if c.value < 0x20 { out += String(format: "\\\\u%04x", c.value) } else { out.unicodeScalars.append(c) }
    }
  }
  return out + "\\""
}

func num(_ s: String) -> Double { guard let v = Double(s) else { die("bad number: " + s) }; return v }

func post(_ event: CGEvent?) {
  guard let e = event else { die("could not create CGEvent (missing Accessibility permission?)") }
  e.post(tap: .cghidEventTap)
  usleep(12_000)
}

func frontmostName() -> String { NSWorkspace.shared.frontmostApplication?.localizedName ?? "" }

let keyCodes: [String: CGKeyCode] = [
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11,
  "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21,
  "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31,
  "u": 32, "[": 33, "i": 34, "p": 35, "return": 36, "enter": 36, "l": 37, "j": 38, "'": 39,
  "k": 40, ";": 41, "\\\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "tab": 48,
  "space": 49, "\`": 50, "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
  "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100,
  "f9": 101, "f10": 109, "f11": 103, "f12": 111, "home": 115, "pageup": 116,
  "forwarddelete": 117, "end": 119, "pagedown": 121, "left": 123, "right": 124,
  "down": 125, "up": 126,
]

func postKey(_ code: CGKeyCode, _ flags: CGEventFlags = []) {
  let d = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true); d?.flags = flags; post(d)
  let u = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false); u?.flags = flags; post(u)
}

// Text fields accept Unicode injection, but native apps such as Calculator listen for physical
// key events. Use the real US-layout key codes for ASCII and fall back to Unicode only when a
// character has no physical representation.
func physicalKey(_ ch: Character) -> (CGKeyCode, CGEventFlags)? {
  let s = String(ch)
  let shifted: [String: String] = [
    "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8",
    "(": "9", ")": "0", "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\\\",
    ":": ";", "<": ",", ">": ".", "?": "/", "~": "\`"
  ]
  if let base = shifted[s], let code = keyCodes[base] { return (code, .maskShift) }
  if s == "\\n" || s == "\\r" { return (keyCodes["return"]!, []) }
  let lower = s.lowercased()
  if let code = keyCodes[lower] {
    return (code, s != lower ? .maskShift : [])
  }
  return nil
}

let args = CommandLine.arguments
guard args.count >= 2 else { die("usage: bimax-desktop <command> [args]") }

switch args[1] {

case "status":
  let screen = CGPreflightScreenCaptureAccess()
  let ax = AXIsProcessTrusted()
  var displays = "["
  for (i, s) in NSScreen.screens.enumerated() {
    if i > 0 { displays += "," }
    let f = s.frame
    displays += "{\\"index\\":\\(i + 1),\\"width\\":\\(Int(f.width)),\\"height\\":\\(Int(f.height)),\\"scale\\":\\(s.backingScaleFactor),\\"main\\":\\(s == NSScreen.main)}"
  }
  displays += "]"
  print("{\\"ok\\":true,\\"accessibility\\":\\(ax),\\"screenRecording\\":\\(screen),\\"displays\\":\\(displays),\\"frontmost\\":\\(jstr(frontmostName()))}")

case "request-access":
  let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
  let ax = AXIsProcessTrustedWithOptions(opts)
  let screen = CGRequestScreenCaptureAccess()
  print("{\\"ok\\":true,\\"accessibility\\":\\(ax),\\"screenRecording\\":\\(screen)}")

case "cursor":
  let loc = CGEvent(source: nil)?.location ?? .zero
  print("{\\"ok\\":true,\\"x\\":\\(Int(loc.x)),\\"y\\":\\(Int(loc.y))}")

case "frontmost":
  print("{\\"ok\\":true,\\"app\\":\\(jstr(frontmostName()))}")

case "move":
  guard args.count >= 4 else { die("move x y") }
  let p = CGPoint(x: num(args[2]), y: num(args[3]))
  post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
  print("{\\"ok\\":true}")

case "click":
  guard args.count >= 4 else { die("click x y [left|right|middle] [count]") }
  let p = CGPoint(x: num(args[2]), y: num(args[3]))
  let button = args.count >= 5 ? args[4] : "left"
  let count = args.count >= 6 ? Int(num(args[5])) : 1
  guard count >= 1 && count <= 3 else { die("count must be 1-3") }
  var mb = CGMouseButton.left; var down = CGEventType.leftMouseDown; var up = CGEventType.leftMouseUp
  if button == "right" { mb = .right; down = .rightMouseDown; up = .rightMouseUp }
  else if button == "middle" { mb = .center; down = .otherMouseDown; up = .otherMouseUp }
  post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: mb))
  for c in 1...count {
    let d = CGEvent(mouseEventSource: nil, mouseType: down, mouseCursorPosition: p, mouseButton: mb)
    d?.setIntegerValueField(.mouseEventClickState, value: Int64(c)); post(d)
    let u = CGEvent(mouseEventSource: nil, mouseType: up, mouseCursorPosition: p, mouseButton: mb)
    u?.setIntegerValueField(.mouseEventClickState, value: Int64(c)); post(u)
  }
  print("{\\"ok\\":true,\\"app\\":\\(jstr(frontmostName()))}")

case "drag":
  guard args.count >= 6 else { die("drag x1 y1 x2 y2") }
  let a = CGPoint(x: num(args[2]), y: num(args[3]))
  let b = CGPoint(x: num(args[4]), y: num(args[5]))
  post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: a, mouseButton: .left))
  post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: a, mouseButton: .left))
  let steps = 14
  for i in 1...steps {
    let t = Double(i) / Double(steps)
    let p = CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
    post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left))
  }
  post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: b, mouseButton: .left))
  print("{\\"ok\\":true}")

case "scroll":
  guard args.count >= 6 else { die("scroll x y dx dy") }
  let p = CGPoint(x: num(args[2]), y: num(args[3]))
  post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
  // Positive dy = scroll DOWN (content moves up); CGEvent wheel1 positive = up, so negate.
  let e = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
                  wheel1: Int32(-num(args[5])), wheel2: Int32(-num(args[4])), wheel3: 0)
  post(e)
  print("{\\"ok\\":true}")

case "key":
  guard args.count >= 3 else { die("key combo (e.g. cmd+shift+t)") }
  var flags = CGEventFlags()
  var keyName = ""
  for part in args[2].lowercased().split(separator: "+").map(String.init) {
    switch part {
    case "cmd", "command", "meta": flags.insert(.maskCommand)
    case "shift": flags.insert(.maskShift)
    case "alt", "option", "opt": flags.insert(.maskAlternate)
    case "ctrl", "control": flags.insert(.maskControl)
    case "fn": flags.insert(.maskSecondaryFn)
    default: keyName = part
    }
  }
  guard let code = keyCodes[keyName] else { die("unknown key: " + keyName) }
  postKey(code, flags)
  print("{\\"ok\\":true,\\"app\\":\\(jstr(frontmostName()))}")

case "type":
  guard args.count >= 3 else { die("type <base64-utf8>") }
  guard let data = Data(base64Encoded: args[2]), let text = String(data: data, encoding: .utf8) else {
    die("type argument must be base64 UTF-8")
  }
  for ch in text {
    if let (code, flags) = physicalKey(ch) {
      postKey(code, flags)
    } else {
      let units = Array(String(ch).utf16)
      let d = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
      d?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
      post(d)
      let u = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
      u?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
      post(u)
    }
  }
  print("{\\"ok\\":true,\\"app\\":\\(jstr(frontmostName()))}")

default:
  die("unknown command: " + args[1])
}

extension Array {
  func chunked(_ size: Int) -> [[Element]] {
    stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
  }
}
`;

/** Bump when the protocol changes so stale cached binaries are never reused. */
export const DESKTOP_HELPER_VERSION = 2;
