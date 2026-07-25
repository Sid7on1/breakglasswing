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

let eventSource = CGEventSource(stateID: .hidSystemState)

func post(_ event: CGEvent?) {
  guard let e = event else { die("could not create CGEvent (missing Accessibility permission?)") }
  e.post(tap: .cghidEventTap)
  usleep(6_000)
}

/**
 * Wait until the cursor is OBSERVABLY at the requested point, bounded.
 *
 * Posting a mouse event hands it to the window server; the reported cursor position catches up a
 * few milliseconds later. Measured on this machine with a 60-trial probe per variant, one-point
 * hops: reading back immediately after the post reports the PREVIOUS position in 58/60 cases (97%),
 * still 2/55 after a 3ms wait, and 0/60 after 15ms. Posting twice does not help (59/60) — nothing
 * is dropped, the read is simply early.
 *
 * That race is why the live endpoint check failed intermittently, and it matters beyond the check:
 * a verb that returns before the cursor has arrived is a lie to everything that reads the cursor
 * next. So arrival is confirmed rather than assumed, with one re-post half-way through in case an
 * event genuinely was lost, and a deadline so a user physically holding the mouse cannot hang us.
 *
 * Returns the position actually observed, which the caller reports instead of claiming the target.
 */
@discardableResult
func settleCursor(at target: CGPoint, button: CGMouseButton = .left, timeoutUs: UInt32 = 40_000) -> CGPoint {
  var waited: UInt32 = 0
  var reposted = false
  var at = CGEvent(source: nil)?.location ?? target
  while waited < timeoutUs {
    if abs(at.x - target.x) < 0.5 && abs(at.y - target.y) < 0.5 { return at }
    if !reposted && waited >= timeoutUs / 2 {
      reposted = true
      CGEvent(mouseEventSource: eventSource, mouseType: .mouseMoved, mouseCursorPosition: target, mouseButton: button)?
        .post(tap: .cghidEventTap)
    }
    usleep(1_000); waited += 1_000
    at = CGEvent(source: nil)?.location ?? at
  }
  return at
}

// Distance-adaptive eased glide over the ONE real macOS cursor (HID event source, no overlay).
// A human hand resolves a short precise hop in a couple of frames but takes a longer, continuous
// path across the screen; apps tracking hover/appearance see plausible intermediate samples either
// way. Total travel time stays bounded (~15-90ms) so multi-hour runs never crawl.
func glide(to target: CGPoint, button: CGMouseButton = .left) {
  let from = CGEvent(source: nil)?.location ?? target
  let distance = hypot(target.x - from.x, target.y - from.y)
  // A short hop needs no eased path — but it DOES need the endpoint. Returning early here left the
  // cursor up to 3pt short of the requested point for every caller that did not post its own final
  // position, which was the move verb. Accuracy first; the smoothing is the optional part.
  if distance < 3 {
    let exact = CGEvent(mouseEventSource: eventSource, mouseType: .mouseMoved, mouseCursorPosition: target, mouseButton: button)
    exact?.post(tap: .cghidEventTap)
    settleCursor(at: target, button: button)
    return
  }
  let steps = max(3, min(14, Int(distance / 90.0) + 3))
  for i in 1...steps {
    let t = Double(i) / Double(steps)
    // Smoothstep ease-in-out: gentle start, fast middle, gentle arrival — like a real hand.
    // At i == steps, t == 1 and e == 1, so the final sample is EXACTLY the target: the easing
    // shapes the path, never the destination. No jitter is added anywhere, deliberately.
    let e = t * t * (3.0 - 2.0 * t)
    let p = CGPoint(x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e)
    let m = CGEvent(mouseEventSource: eventSource, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: button)
    m?.post(tap: .cghidEventTap)
    usleep(distance > 500 ? 6_000 : 4_000)
  }
  // The eased path ends exactly on the target, but the last sample is subject to the same
  // post-to-observable lag as a short hop, so the arrival is confirmed here too.
  settleCursor(at: target, button: button)
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

// ---- accessibility window handles -------------------------------------------------------------
// Window geometry goes through AX rather than CGWindow because CGWindow is read-only: it can tell
// you where a window is but never move it.

/**
 * Fail with the ACTUAL cause. Every AX read returns empty without Accessibility permission, so a
 * missing-window message here would send the user hunting for a window that is on screen the whole
 * time. Check the permission first and name it.
 */
func axWindowOrDie(_ pid: pid_t) -> AXUIElement {
  guard let window = axWindow(pid) else {
    if !AXIsProcessTrusted() {
      die("Accessibility permission is not granted, so window geometry cannot be read or changed. Run action=request_access, approve BiMax's terminal in System Settings > Privacy & Security > Accessibility, then retry.")
    }
    die("no accessible window for that process — it may have no open window, or its window may be minimized")
  }
  return window
}

/** The window a geometry command should act on: the app's focused window, else its first window. */
func axWindow(_ pid: pid_t) -> AXUIElement? {
  let app = AXUIElementCreateApplication(pid)
  var focused: CFTypeRef?
  if AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focused) == .success,
     let w = focused {
    return (w as! AXUIElement)
  }
  var windows: CFTypeRef?
  if AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windows) == .success,
     let list = windows as? [AXUIElement], let first = list.first {
    return first
  }
  return nil
}

func axFrame(_ window: AXUIElement) -> CGRect? {
  var pv: CFTypeRef?
  var sv: CFTypeRef?
  guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &pv) == .success,
        AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sv) == .success,
        let praw = pv, let sraw = sv else { return nil }
  var origin = CGPoint.zero
  var size = CGSize.zero
  AXValueGetValue(praw as! AXValue, .cgPoint, &origin)
  AXValueGetValue(sraw as! AXValue, .cgSize, &size)
  return CGRect(origin: origin, size: size)
}

func axSetPoint(_ window: AXUIElement, _ attribute: String, _ point: CGPoint) {
  var p = point
  guard let value = AXValueCreate(.cgPoint, &p) else { return }
  AXUIElementSetAttributeValue(window, attribute as CFString, value)
}

func axSetSize(_ window: AXUIElement, _ size: CGSize) {
  var s = size
  guard let value = AXValueCreate(.cgSize, &s) else { return }
  AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, value)
}

/** AXFullScreen is the attribute behind the green button. Not every window exposes it. */
func axFullScreen(_ window: AXUIElement) -> Bool {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(window, "AXFullScreen" as CFString, &value) == .success else { return false }
  return (value as? Bool) ?? false
}

/** Returns false when the window has no fullscreen capability, so the caller can say so honestly
 *  instead of reporting a toggle that never happened. */
func axSetFullScreen(_ window: AXUIElement, _ on: Bool) -> Bool {
  var settable: DarwinBoolean = false
  guard AXUIElementIsAttributeSettable(window, "AXFullScreen" as CFString, &settable) == .success,
        settable.boolValue else { return false }
  return AXUIElementSetAttributeValue(window, "AXFullScreen" as CFString, on as CFTypeRef) == .success
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
  var kids: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &kids) == .success else { return [] }
  return (kids as? [AXUIElement]) ?? []
}

/**
 * Is this window a REAL modal blocker — one the OS will not let you click behind?
 *
 * Geometry cannot answer this. A sheet, a floating inspector, and an Electron app's incidental
 * child window can all be "smaller than, and inside, the main window"; only the first one blocks
 * input. macOS states the answer directly: sheets carry the AXSheet role, and modal dialogs set
 * AXModal or one of the dialog subroles. Ask, rather than infer from a rectangle.
 */
func axIsModalBlocker(_ window: AXUIElement) -> Bool {
  var roleRef: CFTypeRef?
  if AXUIElementCopyAttributeValue(window, kAXRoleAttribute as CFString, &roleRef) == .success,
     let role = roleRef as? String, role == "AXSheet" {
    return true
  }
  var modalRef: CFTypeRef?
  if AXUIElementCopyAttributeValue(window, "AXModal" as CFString, &modalRef) == .success,
     let modal = modalRef as? Bool, modal {
    return true
  }
  var subRef: CFTypeRef?
  if AXUIElementCopyAttributeValue(window, kAXSubroleAttribute as CFString, &subRef) == .success,
     let sub = subRef as? String, sub == "AXDialog" || sub == "AXSystemDialog" {
    return true
  }
  return false
}

func rectJson(_ r: CGRect) -> String {
  return "{\\"x\\":\\(Int(r.minX)),\\"y\\":\\(Int(r.minY)),\\"w\\":\\(Int(r.width)),\\"h\\":\\(Int(r.height))}"
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
  // Report the cursor's OBSERVED position, not the requested one. glide waits for arrival, so these
  // normally agree — and when they do not (the user is holding the mouse, an app repositions the
  // pointer) the caller learns the endpoint was missed instead of being told the move succeeded.
  let at = CGEvent(source: nil)?.location ?? p
  print("{\\"ok\\":true,\\"x\\":\\(Int(at.x)),\\"y\\":\\(Int(at.y)),\\"exact\\":\\(abs(at.x - p.x) < 0.5 && abs(at.y - p.y) < 0.5)}")

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
  post(CGEvent(mouseEventSource: eventSource, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: mb))
  for c in 1...count {
    let d = CGEvent(mouseEventSource: eventSource, mouseType: down, mouseCursorPosition: p, mouseButton: mb)
    d?.flags = flags
    d?.setIntegerValueField(.mouseEventClickState, value: Int64(c)); post(d)
    let u = CGEvent(mouseEventSource: eventSource, mouseType: up, mouseCursorPosition: p, mouseButton: mb)
    u?.flags = flags
    u?.setIntegerValueField(.mouseEventClickState, value: Int64(c)); post(u)
  }
  let landed = CGEvent(source: nil)?.location ?? p
  print("{\\"ok\\":true,\\"app\\":\\(jstr(frontmostName())),\\"x\\":\\(Int(landed.x)),\\"y\\":\\(Int(landed.y))}")

// drag x1 y1 x2 y2 [dwellMs] [stepDelayMs]
//
// Within one window the default fast path is fine. A drag BETWEEN applications is a different
// physical event: the receiving app only registers a drop after it has processed dragging-entered
// and had a chance to highlight its drop target, and the whole default path completes in under a
// tenth of a second — faster than a background app typically gets scheduled. That is why a
// cross-app drop appeared to deliver and then do nothing. Passing dwellMs slows the path down and
// holds the pointer over the destination, still posting dragged events so the drag session stays
// alive rather than looking abandoned.
case "drag":
  guard args.count >= 6 else { die("drag x1 y1 x2 y2 [dwellMs] [stepDelayMs]") }
  let a = CGPoint(x: num(args[2]), y: num(args[3]))
  let b = CGPoint(x: num(args[4]), y: num(args[5]))
  let dwellMs = args.count >= 7 ? Int(num(args[6])) : 0
  let stepDelayUs = args.count >= 8 ? UInt32(num(args[7]) * 1000.0) : 0
  glide(to: a)
  post(CGEvent(mouseEventSource: eventSource, mouseType: .mouseMoved, mouseCursorPosition: a, mouseButton: .left))
  post(CGEvent(mouseEventSource: eventSource, mouseType: .leftMouseDown, mouseCursorPosition: a, mouseButton: .left))
  // Let the source register the press before anything moves: a drag whose first movement lands in
  // the same frame as the press is frequently interpreted as a plain click instead.
  if dwellMs > 0 { usleep(150_000) }
  let steps = dwellMs > 0 ? 28 : 14
  for i in 1...steps {
    let t = Double(i) / Double(steps)
    let p = CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
    post(CGEvent(mouseEventSource: eventSource, mouseType: .leftMouseDragged, mouseCursorPosition: p, mouseButton: .left))
    if stepDelayUs > 0 { usleep(stepDelayUs) }
  }
  // Hold over the destination, continuing to post dragged events at the same point, so the
  // receiving app can accept the drag and show where it would land.
  if dwellMs > 0 {
    for _ in 0..<max(1, dwellMs / 50) {
      post(CGEvent(mouseEventSource: eventSource, mouseType: .leftMouseDragged, mouseCursorPosition: b, mouseButton: .left))
      usleep(50_000)
    }
  }
  post(CGEvent(mouseEventSource: eventSource, mouseType: .leftMouseUp, mouseCursorPosition: b, mouseButton: .left))
  print("{\\"ok\\":true}")

case "scroll":
  guard args.count >= 6 else { die("scroll x y dx dy") }
  let p = CGPoint(x: num(args[2]), y: num(args[3]))
  // Glide the visible cursor over the scroll target first, so the human sees WHERE the agent is
  // scrolling instead of the content moving under a cursor parked somewhere else on screen.
  glide(to: p)
  post(CGEvent(mouseEventSource: eventSource, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left))
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
  post(CGEvent(mouseEventSource: eventSource, mouseType: .mouseMoved, mouseCursorPosition: hp, mouseButton: .left))
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
  post(CGEvent(mouseEventSource: eventSource, mouseType: .mouseMoved, mouseCursorPosition: holdP, mouseButton: hmb))
  let hd = CGEvent(mouseEventSource: eventSource, mouseType: hdown, mouseCursorPosition: holdP, mouseButton: hmb)
  hd?.setIntegerValueField(.mouseEventClickState, value: 1); post(hd)
  usleep(UInt32(max(50, min(5000, holdMs)) * 1000))
  let hu = CGEvent(mouseEventSource: eventSource, mouseType: hup, mouseCursorPosition: holdP, mouseButton: hmb)
  hu?.setIntegerValueField(.mouseEventClickState, value: 1); post(hu)
  print("{\\"ok\\":true,\\"app\\":\\(jstr(frontmostName()))}")

case "mousedown":
  guard args.count >= 4 else { die("mousedown x y [left|right]") }
  let dp = CGPoint(x: num(args[2]), y: num(args[3]))
  let dbtn = args.count >= 5 ? args[4] : "left"
  var dmb = CGMouseButton.left; var dtype = CGEventType.leftMouseDown
  if dbtn == "right" { dmb = .right; dtype = .rightMouseDown } else if dbtn == "middle" { dmb = .center; dtype = .otherMouseDown }
  glide(to: dp, button: dmb)
  post(CGEvent(mouseEventSource: eventSource, mouseType: .mouseMoved, mouseCursorPosition: dp, mouseButton: dmb))
  let dd = CGEvent(mouseEventSource: eventSource, mouseType: dtype, mouseCursorPosition: dp, mouseButton: dmb)
  dd?.setIntegerValueField(.mouseEventClickState, value: 1); post(dd)
  print("{\\"ok\\":true}")

case "mouseup":
  guard args.count >= 4 else { die("mouseup x y [left|right]") }
  let up_p = CGPoint(x: num(args[2]), y: num(args[3]))
  let ubtn = args.count >= 5 ? args[4] : "left"
  var umb = CGMouseButton.left; var utype = CGEventType.leftMouseUp; var udrag = CGEventType.leftMouseDragged
  if ubtn == "right" { umb = .right; utype = .rightMouseUp; udrag = .rightMouseDragged } else if ubtn == "middle" { umb = .center; utype = .otherMouseUp; udrag = .otherMouseDragged }
  // A button may still be held from a prior mousedown; DRAG (not plain move) so the release lands here.
  let um = CGEvent(mouseEventSource: eventSource, mouseType: udrag, mouseCursorPosition: up_p, mouseButton: umb)
  um?.post(tap: .cghidEventTap); usleep(8_000)
  let uu = CGEvent(mouseEventSource: eventSource, mouseType: utype, mouseCursorPosition: up_p, mouseButton: umb)
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

// ---- window geometry ------------------------------------------------------------------------
// Tiling, fullscreen, and "put these side by side" are window-MANAGER operations. Driving them by
// clicking the green button's hover menu or dragging a title bar to a screen edge is slow and
// depends on menu wording; the accessibility API sets the frame directly and works identically for
// every app. Coordinates here are the same top-left screen points the rest of the helper uses;
// NSScreen reports bottom-left Cocoa points, so screen rects are converted once, below.

case "screens":
  // visibleFrame excludes the menu bar and Dock — the area a window can actually occupy, which is
  // what every tiling preset must be computed against.
  let primaryMaxY = NSScreen.screens.first?.frame.maxY ?? 0
  var screensJson = "["
  for (i, s) in NSScreen.screens.enumerated() {
    if i > 0 { screensJson += "," }
    let f = s.frame, v = s.visibleFrame
    let fTop = primaryMaxY - f.maxY, vTop = primaryMaxY - v.maxY
    screensJson += "{\\"index\\":\\(i + 1),\\"main\\":\\(s == NSScreen.main),\\"scale\\":\\(s.backingScaleFactor)"
    screensJson += ",\\"frame\\":{\\"x\\":\\(Int(f.minX)),\\"y\\":\\(Int(fTop)),\\"w\\":\\(Int(f.width)),\\"h\\":\\(Int(f.height))}"
    screensJson += ",\\"visible\\":{\\"x\\":\\(Int(v.minX)),\\"y\\":\\(Int(vTop)),\\"w\\":\\(Int(v.width)),\\"h\\":\\(Int(v.height))}}"
  }
  screensJson += "]"
  print("{\\"ok\\":true,\\"screens\\":\\(screensJson)}")

case "window-at":
  // WHICH window would actually receive a click at this point.
  //
  // A single-window screen capture excludes whatever covers the window, but a synthesized click is
  // delivered to whichever window is topmost at that point on the real screen. When something is on
  // top, the picture and the input disagree and the click lands in the wrong app. CGWindowList
  // returns windows front-to-back, so the first hit IS the recipient.
  guard args.count >= 4 else { die("window-at <x> <y>") }
  let px = num(args[2]), py = num(args[3])
  // AX, not CGWindowList, is the authority here. CGWindowList reports the window STACK, and cannot
  // say whether a window ignores mouse events — measured live, the driver's own click-through
  // overlay sits at layer 0 over the whole target, so a stack-based test declared every point
  // blocked. AXUIElementCopyElementAtPosition performs the real hit test: it returns the element
  // that would actually receive the event, so click-through windows correctly fall through.
  var owner = ""
  var opid: pid_t = 0
  let sys = AXUIElementCreateSystemWide()
  var hitEl: AXUIElement?
  if AXUIElementCopyElementAtPosition(sys, Float(px), Float(py), &hitEl) == .success, let el = hitEl {
    var epid: pid_t = 0
    if AXUIElementGetPid(el, &epid) == .success {
      opid = epid
      owner = NSRunningApplication(processIdentifier: epid)?.localizedName ?? ""
    }
  }
  // The stack answer is reported ALONGSIDE it, never instead of it: it is what names an obstruction
  // for a human ("the Live Preview is over that point") once AX has established there really is one.
  var topName = "", topId = 0, topLayer = 0
  if let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] {
    for w in list {
      guard let b = w[kCGWindowBounds as String] as? [String: Any],
            let bx = b["X"] as? Double, let by = b["Y"] as? Double,
            let bw = b["Width"] as? Double, let bh = b["Height"] as? Double else { continue }
      let layer = (w[kCGWindowLayer as String] as? Int) ?? 0
      if layer < 0 || layer > 3 { continue }
      if let alpha = w[kCGWindowAlpha as String] as? Double, alpha <= 0.01 { continue }
      guard px >= bx, px <= bx + bw, py >= by, py <= by + bh else { continue }
      topId = (w[kCGWindowNumber as String] as? Int) ?? 0
      topLayer = layer
      topName = (w[kCGWindowOwnerName as String] as? String) ?? ""
      break
    }
  }
  print("{\\"ok\\":true,\\"window\\":{\\"owner_pid\\":\\(opid),\\"owner_name\\":\\(jstr(owner))"
    + ",\\"top_window_id\\":\\(topId),\\"top_owner_name\\":\\(jstr(topName)),\\"top_layer\\":\\(topLayer)}}")

case "window-raise":
  // Raise ONE window of an app, not merely the app. AX exposes no window id, so the caller passes
  // the frame it wants raised and we match on it.
  guard args.count >= 7 else { die("window-raise <pid> <x> <y> <w> <h>") }
  let rpid = pid_t(num(args[2]))
  let want = CGRect(x: num(args[3]), y: num(args[4]), width: num(args[5]), height: num(args[6]))
  var rwins: CFTypeRef?
  var raised = false
  if AXUIElementCopyAttributeValue(AXUIElementCreateApplication(rpid), kAXWindowsAttribute as CFString, &rwins) == .success,
     let rlist = rwins as? [AXUIElement] {
    for w in rlist {
      guard let f = axFrame(w) else { continue }
      // Frames drift by a point between APIs; anything within a few points is the same window.
      guard abs(f.minX - want.minX) <= 4, abs(f.minY - want.minY) <= 4,
            abs(f.width - want.width) <= 4, abs(f.height - want.height) <= 4 else { continue }
      raised = AXUIElementPerformAction(w, kAXRaiseAction as CFString) == .success
      break
    }
  }
  if let app = NSRunningApplication(processIdentifier: rpid) {
    app.activate(options: [])
  }
  print("{\\"ok\\":true,\\"raised\\":\\(raised)}")

case "window-frame":
  guard args.count >= 3 else { die("window-frame <pid>") }
  let win = axWindowOrDie(pid_t(num(args[2])))
  guard let rect = axFrame(win) else { die("could not read the window frame (Accessibility permission?)") }
  print("{\\"ok\\":true,\\"frame\\":\\(rectJson(rect)),\\"fullscreen\\":\\(axFullScreen(win))}")

case "ax-enable":
  // Chromium-based apps (Electron: WhatsApp, Slack, Discord, VS Code, Notion…) do not BUILD their
  // accessibility tree until a client asks for it — until then they publish only a shell of
  // unlabeled buttons. Measured on WhatsApp: 31 elements, 22 of them blank AXButtons, versus 397
  // richly-labelled elements for a native app of the same size. That shell is what forced the model
  // to guess raw coordinates, which is what "the clicks are inaccurate" actually was.
  // Setting AXManualAccessibility asks Chromium to build the real tree. Native apps simply refuse
  // the attribute, so this is safe to attempt on anything.
  guard args.count >= 3 else { die("ax-enable <pid>") }
  let epid = pid_t(num(args[2]))
  let eapp = AXUIElementCreateApplication(epid)
  let eres = AXUIElementSetAttributeValue(eapp, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  print("{\\"ok\\":true,\\"applied\\":\\(eres == .success)}")

case "modal-frame":
  guard args.count >= 3 else { die("modal-frame <pid>") }
  let mpid = pid_t(num(args[2]))
  var mwins: CFTypeRef?
  var modalRect: CGRect? = nil
  if AXUIElementCopyAttributeValue(AXUIElementCreateApplication(mpid), kAXWindowsAttribute as CFString, &mwins) == .success,
     let mlist = mwins as? [AXUIElement] {
    for w in mlist where axIsModalBlocker(w) {
      if let r = axFrame(w) { modalRect = r; break }
    }
  }
  if let r = modalRect {
    print("{\\"ok\\":true,\\"modal\\":\\(rectJson(r))}")
  } else {
    print("{\\"ok\\":true,\\"modal\\":null}")
  }

case "window-set-frame":
  guard args.count >= 7 else { die("window-set-frame <pid> <x> <y> <w> <h>") }
  let swin = axWindowOrDie(pid_t(num(args[2])))
  let want = CGRect(x: num(args[3]), y: num(args[4]), width: num(args[5]), height: num(args[6]))
  // A window already in native fullscreen ignores frame changes and silently stays put. Leave
  // fullscreen first so a tile request cannot appear to succeed while nothing moves.
  if axFullScreen(swin) { _ = axSetFullScreen(swin, false); usleep(700_000) }
  // Position, then size, then position again. AppKit clamps a move against the CURRENT size, so a
  // window moving toward a screen edge gets shoved back until it has been resized; setting position
  // twice around the resize is what makes a right-half tile land on the first try.
  axSetPoint(swin, kAXPositionAttribute, CGPoint(x: want.minX, y: want.minY))
  axSetSize(swin, CGSize(width: want.width, height: want.height))
  axSetPoint(swin, kAXPositionAttribute, CGPoint(x: want.minX, y: want.minY))
  usleep(120_000)
  // Report what the window ACTUALLY became: apps enforce minimum sizes and size increments, so the
  // achieved frame is frequently not the requested one and the caller must be told rather than
  // assuming the request was honored.
  guard let got = axFrame(swin) else { die("window frame could not be read back after the change") }
  print("{\\"ok\\":true,\\"requested\\":\\(rectJson(want)),\\"frame\\":\\(rectJson(got))}")

case "window-fullscreen":
  guard args.count >= 4 else { die("window-fullscreen <pid> <true|false>") }
  let fwin = axWindowOrDie(pid_t(num(args[2])))
  let wantFull = args[3] == "true" || args[3] == "1"
  let accepted = axSetFullScreen(fwin, wantFull)
  // The transition is animated and takes roughly a second. Poll until the window settles rather
  // than sampling once: reading mid-flight reports the OLD state, which turned a working toggle
  // into a reported failure — and, worse, reported the requested state as already reached.
  if accepted {
    for _ in 0..<25 {
      usleep(100_000)
      if axFullScreen(fwin) == wantFull { break }
    }
  }
  let settled = axFullScreen(fwin)
  print("{\\"ok\\":true,\\"supported\\":\\(accepted),\\"fullscreen\\":\\(settled),\\"matched\\":\\(settled == wantFull)}")

// ---- desktop surface ---------------------------------------------------------------------------
// The desktop is not an ordinary window: the file manager publishes it as a full-screen AXScrollArea
// with no title bar and no close button, so a driver that models "application windows" either skips
// it or reports the menu-bar proxy instead. Its icons ARE fully exposed through accessibility
// though — each with a name and a real global frame — so enumerate them here and let the caller
// drag them around in the same global screen points every other pointer command already uses.

case "desktop-icons":
  // Find the desktop's owning process by WINDOW LEVEL rather than by app name. The desktop icon
  // window sits at a level the OS itself defines, so this identifies the right process on any
  // system — including one where the file manager is renamed, localized, or replaced — without
  // this code ever knowing what that application is called.
  let iconLevel = Int(CGWindowLevelForKey(.desktopIconWindow))
  let onScreen = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
  let owner = onScreen.first { ($0[kCGWindowLayer as String] as? Int) == iconLevel }
  guard let dpid = owner?[kCGWindowOwnerPID as String] as? pid_t else {
    die("no desktop icon surface is present on this system")
  }
  let dapp = AXUIElementCreateApplication(dpid)
  var dwins: CFTypeRef?
  guard AXUIElementCopyAttributeValue(dapp, kAXWindowsAttribute as CFString, &dwins) == .success,
        let dwin = (dwins as? [AXUIElement])?.first else {
    if !AXIsProcessTrusted() {
      die("Accessibility permission is not granted, so desktop icons cannot be listed. Run action=request_access, approve BiMax's terminal in System Settings > Privacy & Security > Accessibility, then retry.")
    }
    die("the desktop owner exposes no accessible surface")
  }
  // The icons hang one level below the scroll area, inside a group that fills the screen. Walk down
  // to the first level that actually has several children rather than assuming a fixed depth, so a
  // future OS that adds or removes a wrapper does not silently return an empty list.
  var container = dwin
  for _ in 0..<4 {
    let kids = axChildren(container)
    if kids.count > 1 { break }
    guard let only = kids.first else { break }
    container = only
  }
  var iconsJson = "["
  var iconCount = 0
  for icon in axChildren(container) {
    var titleRef: CFTypeRef?
    AXUIElementCopyAttributeValue(icon, kAXTitleAttribute as CFString, &titleRef)
    let title = (titleRef as? String) ?? ""
    guard let rect = axFrame(icon), rect.width > 0, rect.height > 0 else { continue }
    if iconCount > 0 { iconsJson += "," }
    iconsJson += "{\\"name\\":\\(jstr(title)),\\"frame\\":\\(rectJson(rect))}"
    iconCount += 1
  }
  iconsJson += "]"
  print("{\\"ok\\":true,\\"icons\\":\\(iconsJson),\\"count\\":\\(iconCount)}")

// ---- clipboard ------------------------------------------------------------------------------
// The pasteboard is the OS-level bridge between apps: it is how text moves from one app to another
// and how a file is handed to an app that accepts a paste. It is also the only honest way to verify
// a copy. NSPasteboard.changeCount increments on every write by ANY process, so comparing it across
// a Cmd+C proves whether the copy actually placed something — a keystroke that "delivered" but had
// no selection leaves it untouched. Text is base64 on the wire in both directions so arbitrary
// content (newlines, emoji, quotes) survives the single-shot CLI protocol intact.

case "clipboard-read":
  let rpb = NSPasteboard.general
  var rtext = ""
  if let s = rpb.string(forType: .string) { rtext = s }
  var rfiles: [String] = []
  if let urls = rpb.readObjects(forClasses: [NSURL.self], options: nil) as? [URL] {
    rfiles = urls.filter { $0.isFileURL }.map { $0.path }
  }
  var rfilesJson = "["
  for (i, f) in rfiles.enumerated() { if i > 0 { rfilesJson += "," }; rfilesJson += jstr(f) }
  rfilesJson += "]"
  var rtypesJson = "["
  for (i, t) in (rpb.types ?? []).enumerated() { if i > 0 { rtypesJson += "," }; rtypesJson += jstr(t.rawValue) }
  rtypesJson += "]"
  print("{\\"ok\\":true,\\"changeCount\\":\\(rpb.changeCount),\\"textBase64\\":\\(jstr(Data(rtext.utf8).base64EncodedString())),\\"files\\":\\(rfilesJson),\\"types\\":\\(rtypesJson)}")

case "clipboard-write":
  guard args.count >= 3 else { die("clipboard-write <base64-utf8>") }
  guard let wdata = Data(base64Encoded: args[2]), let wtext = String(data: wdata, encoding: .utf8) else {
    die("clipboard-write argument must be base64 UTF-8")
  }
  let wpb = NSPasteboard.general
  wpb.clearContents()
  wpb.setString(wtext, forType: .string)
  print("{\\"ok\\":true,\\"changeCount\\":\\(wpb.changeCount)}")

case "clipboard-write-files":
  guard args.count >= 3 else { die("clipboard-write-files <path> [<path>...]") }
  // Put the file list on the pasteboard EAGERLY, in a form that outlives this process.
  //
  // Two spellings look right and both fail silently from a single-shot CLI, because the pasteboard
  // server keeps only a lazy reference back to the writing process:
  //   - writeObjects([NSURL])           — NSURL writes through a provider owned by this process, so
  //                                       the entry evaporates entirely on exit.
  //   - writeObjects([NSPasteboardItem]) — the FIRST item survives; every later one is dropped.
  // In both cases changeCount still advances, so the write LOOKS successful while the pasteboard is
  // empty or truncated.
  //
  // declareTypes(owner: nil) + setPropertyList is the eager path: no owner means no promise to
  // fulfil, and the legacy NSFilenamesPboardType flavor carries ALL paths in one property list.
  // macOS expands that back into one pasteboard item per file, so modern readers asking for
  // public.file-url and older apps asking for the legacy flavor both see every file.
  var wpaths: [String] = []
  for p in args[2...] {
    let expanded = (p as NSString).expandingTildeInPath
    guard FileManager.default.fileExists(atPath: expanded) else { die("no such file: " + expanded) }
    wpaths.append(expanded)
  }
  let filenamesType = NSPasteboard.PasteboardType("NSFilenamesPboardType")
  let fpb = NSPasteboard.general
  fpb.clearContents()
  fpb.declareTypes([.fileURL, filenamesType], owner: nil)
  fpb.setString(URL(fileURLWithPath: wpaths[0]).absoluteString, forType: .fileURL)
  guard fpb.setPropertyList(wpaths, forType: filenamesType) else { die("pasteboard refused the file list") }
  print("{\\"ok\\":true,\\"changeCount\\":\\(fpb.changeCount),\\"count\\":\\(wpaths.count)}")

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
export const DESKTOP_HELPER_VERSION = 17; // v17: cursor arrival is waited for and reported, not assumed (v16: glide always lands on the exact endpoint; v15: window hit test + single-window raise; v14: Chromium AXManualAccessibility opt-in; v13: AX modal-blocker probe; v12: desktop icons; v11: drag dwell pacing; v10: AX window geometry + screens)
