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

// Glide the visible cursor from wherever it is to the target instead of teleporting: the human
// watching the run can follow what is about to be clicked. ~16 steps x 10ms ≈ 160ms per travel.
func glide(to target: CGPoint, button: CGMouseButton = .left) {
  let from = CGEvent(source: nil)?.location ?? target
  let steps = 16
  for i in 1...steps {
    let t = Double(i) / Double(steps)
    // Ease-out: fast leave, gentle arrival — reads as intentional, not as a laggy warp.
    let e = 1.0 - (1.0 - t) * (1.0 - t)
    let p = CGPoint(x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e)
    let m = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: button)
    m?.post(tap: .cghidEventTap)
    usleep(10_000)
  }
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
  glide(to: p)
  print("{\\"ok\\":true}")

case "click":
  guard args.count >= 4 else { die("click x y [left|right|middle] [count] [modifiers]") }
  let p = CGPoint(x: num(args[2]), y: num(args[3]))
  let button = args.count >= 5 ? args[4] : "left"
  let count = args.count >= 6 ? Int(num(args[5])) : 1
  let modifierNames = args.count >= 7 ? args[6].lowercased().split(separator: ",").map(String.init) : []
  var flags = CGEventFlags()
  for modifier in modifierNames {
    switch modifier {
    case "cmd", "command", "meta": flags.insert(.maskCommand)
    case "shift": flags.insert(.maskShift)
    case "alt", "option", "opt": flags.insert(.maskAlternate)
    case "ctrl", "control": flags.insert(.maskControl)
    case "fn": flags.insert(.maskSecondaryFn)
    case "": break
    default: die("unknown click modifier: " + modifier)
    }
  }
  guard count >= 1 && count <= 3 else { die("count must be 1-3") }
  var mb = CGMouseButton.left; var down = CGEventType.leftMouseDown; var up = CGEventType.leftMouseUp
  if button == "right" { mb = .right; down = .rightMouseDown; up = .rightMouseUp }
  else if button == "middle" { mb = .center; down = .otherMouseDown; up = .otherMouseUp }
  glide(to: p, button: mb)
  post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: mb))
  for c in 1...count {
    let d = CGEvent(mouseEventSource: nil, mouseType: down, mouseCursorPosition: p, mouseButton: mb)
    d?.flags = flags
    d?.setIntegerValueField(.mouseEventClickState, value: Int64(c)); post(d)
    let u = CGEvent(mouseEventSource: nil, mouseType: up, mouseCursorPosition: p, mouseButton: mb)
    u?.flags = flags
    u?.setIntegerValueField(.mouseEventClickState, value: Int64(c)); post(u)
  }
  print("{\\"ok\\":true,\\"app\\":\\(jstr(frontmostName()))}")

case "drag":
  guard args.count >= 6 else { die("drag x1 y1 x2 y2") }
  let a = CGPoint(x: num(args[2]), y: num(args[3]))
  let b = CGPoint(x: num(args[4]), y: num(args[5]))
  glide(to: a)
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
  // Glide the visible cursor over the scroll target first, so the human sees WHERE the agent is
  // scrolling instead of the content moving under a cursor parked somewhere else on screen.
  glide(to: p)
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

case "hover":
  guard args.count >= 4 else { die("hover x y [ms]") }
  let hp = CGPoint(x: num(args[2]), y: num(args[3]))
  glide(to: hp)
  post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: hp, mouseButton: .left))
  let hoverMs = args.count >= 5 ? Int(num(args[4])) : 400
  usleep(UInt32(max(0, min(5000, hoverMs)) * 1000))
  print("{\\"ok\\":true,\\"app\\":\\(jstr(frontmostName()))}")

case "hold":
  // Click-and-hold, done ATOMICALLY in one process (down → wait → up) so a crashed invocation can
  // never leave the physical button stuck. Cross-process mousedown/mouseup exist below for staged
  // selection, but hold is the safe default for "press and hold".
  guard args.count >= 4 else { die("hold x y [ms] [left|right]") }
  let holdP = CGPoint(x: num(args[2]), y: num(args[3]))
  let holdMs = args.count >= 5 ? Int(num(args[4])) : 800
  let holdBtn = args.count >= 6 ? args[5] : "left"
  var hmb = CGMouseButton.left; var hdown = CGEventType.leftMouseDown; var hup = CGEventType.leftMouseUp
  if holdBtn == "right" { hmb = .right; hdown = .rightMouseDown; hup = .rightMouseUp }
  glide(to: holdP, button: hmb)
  post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: holdP, mouseButton: hmb))
  let hd = CGEvent(mouseEventSource: nil, mouseType: hdown, mouseCursorPosition: holdP, mouseButton: hmb)
  hd?.setIntegerValueField(.mouseEventClickState, value: 1); post(hd)
  usleep(UInt32(max(50, min(5000, holdMs)) * 1000))
  let hu = CGEvent(mouseEventSource: nil, mouseType: hup, mouseCursorPosition: holdP, mouseButton: hmb)
  hu?.setIntegerValueField(.mouseEventClickState, value: 1); post(hu)
  print("{\\"ok\\":true,\\"app\\":\\(jstr(frontmostName()))}")

case "mousedown":
  guard args.count >= 4 else { die("mousedown x y [left|right]") }
  let dp = CGPoint(x: num(args[2]), y: num(args[3]))
  let dbtn = args.count >= 5 ? args[4] : "left"
  var dmb = CGMouseButton.left; var dtype = CGEventType.leftMouseDown
  if dbtn == "right" { dmb = .right; dtype = .rightMouseDown } else if dbtn == "middle" { dmb = .center; dtype = .otherMouseDown }
  glide(to: dp, button: dmb)
  post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: dp, mouseButton: dmb))
  let dd = CGEvent(mouseEventSource: nil, mouseType: dtype, mouseCursorPosition: dp, mouseButton: dmb)
  dd?.setIntegerValueField(.mouseEventClickState, value: 1); post(dd)
  print("{\\"ok\\":true}")

case "mouseup":
  guard args.count >= 4 else { die("mouseup x y [left|right]") }
  let up_p = CGPoint(x: num(args[2]), y: num(args[3]))
  let ubtn = args.count >= 5 ? args[4] : "left"
  var umb = CGMouseButton.left; var utype = CGEventType.leftMouseUp; var udrag = CGEventType.leftMouseDragged
  if ubtn == "right" { umb = .right; utype = .rightMouseUp; udrag = .rightMouseDragged } else if ubtn == "middle" { umb = .center; utype = .otherMouseUp; udrag = .otherMouseDragged }
  // A button may still be held from a prior mousedown; DRAG (not plain move) so the release lands here.
  let um = CGEvent(mouseEventSource: nil, mouseType: udrag, mouseCursorPosition: up_p, mouseButton: umb)
  um?.post(tap: .cghidEventTap); usleep(8_000)
  let uu = CGEvent(mouseEventSource: nil, mouseType: utype, mouseCursorPosition: up_p, mouseButton: umb)
  uu?.setIntegerValueField(.mouseEventClickState, value: 1); post(uu)
  print("{\\"ok\\":true}")

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
export const DESKTOP_HELPER_VERSION = 6; // v6: hover, atomic hold, mousedown/mouseup primitives
