import UIKit
import UserNotifications

/// Nudge on iPhone: the same pages as the other builds, with the phone's own
/// notifications doing the reminding.
@MainActor
enum App {
    static let config = ShellConfig(
        bridge: "nudgeApp",
        host: "nudge",
        root: "/",
        start: "/",
        background: UIColor(named: "Page") ?? .systemBackground
    )

    private static let taps = ReminderTaps()
    private static let edge = EdgeBack()
    /// The page has said hello and can take messages.
    private static var ready = false
    /// A reminder was tapped before the page was up: the task to open once it is.
    private static var waiting: String?

    static func launched() {
        // Set here, at launch, so Done on a reminder works with the app closed.
        Reminders.register()
        UNUserNotificationCenter.current().delegate = taps
    }

    static func setUp(_ shell: Shell) {
        ready = false
        // The pages know where they are before they draw anything.
        shell.scripts = ["window.nudgePlatform = 'ios';"]
        shell.onMessage = { type, msg in
            switch type {
            case "hello":
                ready = false
                return false
            case "save":
                if let state = msg["state"] as? String {
                    Reminders.keep(state: state)
                    // Taps handed over are in it now, and finished tasks stop showing.
                    Reminders.heard()
                    Reminders.clearShown(state: state)
                }
                Reminders.plan(msg["alarms"] as? [[String: Any]] ?? [])
                return true
            case "askNotifications":
                Notices.ask { _ in granted() }
                return true
            case "openSettings":
                // Never asked: ask now. Refused before: only Settings can change it.
                Reminders.undecided { fresh in
                    if fresh {
                        Notices.ask { _ in granted() }
                    } else if let settings = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(settings)
                    }
                }
                return true
            case "back", "checkUpdate", "installUpdate":
                return true
            default:
                return false
            }
        }
        shell.onReady = {
            ready = true
            var message: [String: Any] = ["type": "state", "actions": Reminders.takeActions()]
            if let state = Reminders.savedState() { message["state"] = state }
            Shell.current?.send(message)
            sendHealth()
            if let task = waiting {
                waiting = nil
                Shell.current?.send(["type": "open", "task": task])
            }
        }
        // The page is starting again and has heard nothing: taps wait for its hello.
        shell.onRestart = { ready = false }
        shell.onActive = {
            guard ready else { return }
            sendHealth()
            // Whatever was tapped on a reminder while the app was away. The page
            // saves after taking it, which plans the reminders again. With nothing
            // tapped, the last plan is topped up as it stands.
            if !sendActions() { Reminders.planAgain() }
        }
        // A swipe in from the left edge goes back a page, as the Back button does.
        let swipe = UIScreenEdgePanGestureRecognizer(target: edge, action: #selector(EdgeBack.swiped(_:)))
        swipe.edges = .left
        swipe.delegate = edge
        shell.view.addGestureRecognizer(swipe)
    }

    static func opened(link: URL) {}

    /// The shell's own route for a tapped notification. Nudge's go through ReminderTaps.
    static func opened(notification: [AnyHashable: Any]) {
        open(task: notification["task"] as? String ?? "")
    }

    /// A tapped reminder opens its task.
    static func open(task: String) {
        guard !task.isEmpty else { return }
        if ready, let shell = Shell.current {
            shell.send(["type": "open", "task": task])
        } else {
            waiting = task
        }
    }

    /// Done or a snooze was tapped on a reminder. If the app is in front, the page hears now.
    static func acted() {
        guard ready, UIApplication.shared.applicationState == .active else { return }
        _ = sendActions()
    }

    private static func sendActions() -> Bool {
        guard let shell = Shell.current else { return false }
        let actions = Reminders.takeActions()
        if actions.isEmpty { return false }
        shell.send(["type": "actions", "actions": actions])
        return true
    }

    /// The answer to being asked about notifications. Reminders planned before
    /// it were turned away by iOS, so they go in again.
    private static func granted() {
        Reminders.planAgain()
        sendHealth()
    }

    /// What the page's reminder check shows. Only notifications can be off on iPhone.
    private static func sendHealth() {
        Notices.allowed { allowed in
            Shell.current?.send([
                "type": "health", "notifications": allowed,
                "exact": true, "battery": true, "fullScreen": true, "overlay": true,
            ])
        }
    }
}

/// The swipe from the left edge. It runs alongside scrolling rather than waiting
/// on it, and only a swipe that ends well across the screen counts.
@MainActor
final class EdgeBack: NSObject, UIGestureRecognizerDelegate {
    @objc func swiped(_ pan: UIScreenEdgePanGestureRecognizer) {
        guard pan.state == .ended else { return }
        let moved = pan.translation(in: pan.view)
        guard moved.x > 60, abs(moved.y) < moved.x else { return }
        Shell.current?.run("if (window.nudgeBack) window.nudgeBack();")
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        true
    }
}
