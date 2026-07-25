/**
 * Operational guidance for driving the desktop — injected only on turns that actually ask for it.
 *
 * This text used to live inside ComputerTool's schema description, which meant every request paid
 * for it. Measured: the tool's schema was 3,461 tokens of the ~12,000 spent on tool schemas per
 * turn, and ~19,150 tokens were sent to answer "say ok". None of this is needed to CHOOSE the tool
 * — only to use it well once chosen — so it moved behind the gate the persona already had
 * (`explicitlyRequiresComputerUse`).
 *
 * The split rule: the schema carries what the model needs to pick the tool and call it correctly
 * (the loop contract, handle precedence, frameId). Everything scenario-specific lives here.
 */
export const COMPUTER_USE_PLAYBOOK = `[Desktop operation playbook — this task involves the user's computer.]

MULTIPLE APPS
open launches an app, registers it, and makes it active. Every app opened this session STAYS registered, but only the active one receives input, because coordinates and element handles are grounded in the active app's newest frame. To switch between apps already open, use focus (app or pid) — it activates the app and returns a fresh frame, without the re-launch that open would cause. Re-opening a running app risks a second instance and discards its current state, so reach for focus whenever the app is already open. A cross-app task is therefore: open A → work → open/focus B → work → focus A → continue. Naming a non-active app on an acting verb is refused and the error tells you which verb to use.

THE DESKTOP
The desktop is not an app window — it has no window id and window-scoped observation cannot see it. Use desktop: with no arguments it lists every item on it by name with its on-screen rectangle. To move one, pass query="<item name>" plus either toQuery="<name of a folder on the desktop>" to file it into that folder, or toX/toY screen points to reposition it. The move is verified by re-reading the desktop: an item that filed away disappears, a repositioned one has a new rectangle, and one that did not move at all is reported as a failure (usually the desktop is using Stacks or Sort By, which snaps items back).

ARRANGING WINDOWS
arrange places the ACTIVE window: layout=left/right/top/bottom or a quadrant tiles it within the screen's usable area (below the menu bar, clear of the Dock), maximize fills that area, center restores a floating size, and bounds sets an exact rectangle. layout=fullscreen is the native macOS fullscreen Space, which is NOT the same as maximize — only fullscreen windows can be switched between with the Space shortcuts. To put two apps side by side: focus A → arrange left → focus B → arrange right. Apps enforce their own minimum sizes and size increments, so the result reports the ACHIEVED frame; when it differs from what was asked, the window is placed but may still overlap its neighbour — read windowFrame rather than assuming the request was honored. Fullscreen is only accepted for the frontmost app, and panels/utility windows cannot go fullscreen at all.

DRAGGING BETWEEN APPS
drag with toApp drops into another open app: the source point is read in the active window, the destination in toApp's window. Both windows must be visible SIMULTANEOUSLY, so arrange them first (focus A → arrange left, focus B → arrange right) — if the source window covers the drop point the drag is refused rather than dropped back onto the source. After the drop, toApp becomes the active target and its frame is attached. Delivery is not acceptance: an app silently ignores content types it does not handle, so confirm from the frame that the content actually arrived. For files specifically, the clipboard route (clipboard paths=[…] then paste) is more reliable than dragging and needs no window arrangement.

SPACES (fullscreen apps and extra desktops)
Ctrl+Left / Ctrl+Right / Ctrl+1..9 are handled by macOS itself, not by the focused app: they change which Space — and therefore which windows — exist on screen. Send them with key. Afterwards the app you were working on may be on a Space that is no longer visible, so the runtime re-checks what is actually in front: if that app is already open in this session it becomes the active target and you get a fresh frame of it; otherwise there is NO active target and you must open or focus something before acting. Only fullscreen windows and additional desktops are switchable, so arrange layout=fullscreen first if you want an app to have its own Space. Ctrl+Up (Mission Control) and Ctrl+Down (App Exposé) cover the screen with an overlay — nothing is capturable until you press escape.

MOVING CONTENT BETWEEN APPS
The clipboard is the OS bridge and works the same for every application. copy presses the copy shortcut on the active app and VERIFIES it: the OS write counter must advance, so "nothing was selected" is reported as a failure instead of a silent no-op — select the content first, then copy. paste presses paste on the active app and checks the fresh frame for the pasted text. clipboard reads the clipboard, or writes it: value=text, or paths=[absolute file paths] to place the FILES themselves on it, which is how you hand an app a photo or document — a path written as text would only paste the filename. So moving text app-to-app is: focus source → select → copy → focus destination → click the field → paste. Sending a file is: clipboard paths=[…] → focus destination → click the field → paste (or use the app's own attach control and file picker when it does not accept a paste).

MESSAGE COMPOSERS
Any surface with a composer and a transcript above it (chat, mail, comments, notes with an entry field) works the same way: open the app → select the conversation or record → click the composer → type → COMMIT. Commit with key combo "return" in the composer; commit buttons are frequently unlabeled icons that a raw click misses. Selecting the conversation is NOT committing. Success is proven ONLY by a post-action frame showing the content in the transcript AND the composer cleared — text still in the composer, or nothing new in the transcript, means it was not sent; do not report success.

EVIDENCE
Success requires visible or semantic postcondition evidence, not driver delivery, and the evidence must match the value type the user asked for. For sliders use set_value with a fresh query/element handle: maximum/full/100% = 1, minimum/mute/0% = 0 — never click or drag a slider to approximate an exact value. A right-click returns a full-display frame because the menu is its own OS window, and old window handles are invalid until the next observe. Dialogs and popovers block the controls behind them. Finish the whole workflow, including cleanup, before replying.`;
