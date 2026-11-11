import Foundation
import UserNotifications

/// Reminders as the phone's own notifications. They ring with the app closed.
///
/// The page sends its whole list of alarms, soonest first, each time anything
/// changes. iOS keeps at most 64 waiting per app, so the soonest go in and the
/// rest wait for the next time the app is opened.
enum Reminders {
    /// Under iOS's 64, with room for a snooze or two set from a notification.
    static let limit = 60
    /// A task set to keep nudging rings this many more times if nothing is tapped.
    static let follows = 3
    /// Slots held back for those, when there are that many reminders.
    private static let heldForFollows = 16
    private static let category = "task"
    private static let lock = NSLock()
    /// The page writes its dates in this calendar, whatever the phone is set to.
    /// Made each time, so it follows the phone into a new time zone.
    private static var calendar: Calendar {
        var out = Calendar(identifier: .gregorian)
        out.timeZone = .autoupdatingCurrent
        return out
    }
    /// How many of the taps waiting in actions.json the page has been handed.
    private static var handed = 0

    // MARK: Files

    // Plain files in the app's own folder, which the phone backs up.
    private static func file(_ name: String) -> URL {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent(name)
    }

    private static func rows(_ name: String) -> [[String: Any]] {
        guard let data = try? Data(contentsOf: file(name)),
              let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return [] }
        return list
    }

    private static func write(_ list: [[String: Any]], _ name: String) {
        guard JSONSerialization.isValidJSONObject(list),
              let data = try? JSONSerialization.data(withJSONObject: list) else { return }
        try? data.write(to: file(name), options: .atomic)
    }

    /// The tasks, as the page last saved them.
    static func keep(state: String) {
        guard state.hasPrefix("{"), let data = state.data(using: .utf8) else { return }
        lock.lock()
        defer { lock.unlock() }
        try? data.write(to: file("state.json"), options: .atomic)
    }

    static func savedState() -> String? {
        lock.lock()
        defer { lock.unlock() }
        guard let text = try? String(contentsOf: file("state.json"), encoding: .utf8), text.hasPrefix("{") else { return nil }
        return text
    }

    /// What was tapped on reminders since the page last saved. They stay on file
    /// until it does, so none is lost if the page ends first.
    static func takeActions() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        let actions = rows("actions.json")
        handed = actions.count
        return actions
    }

    /// The page has saved: what it was handed is in its tasks now, and can go.
    static func heard() {
        lock.lock()
        defer { lock.unlock() }
        guard handed > 0 else { return }
        let left = Array(rows("actions.json").dropFirst(handed))
        handed = 0
        if left.isEmpty {
            try? FileManager.default.removeItem(at: file("actions.json"))
        } else {
            write(left, "actions.json")
        }
    }

    private static func queue(_ action: [String: Any]) {
        lock.lock()
        defer { lock.unlock() }
        write(rows("actions.json") + [action], "actions.json")
    }

    // MARK: Asking

    static func register() {
        let done = UNNotificationAction(identifier: "done", title: "Done", options: [])
        let ten = UNNotificationAction(identifier: "snooze10", title: "10 min", options: [])
        let hour = UNNotificationAction(identifier: "snooze60", title: "1 hour", options: [])
        let task = UNNotificationCategory(identifier: category, actions: [done, ten, hour], intentIdentifiers: [], options: [.customDismissAction])
        UNUserNotificationCenter.current().setNotificationCategories([task])
    }

    /// True when the person has never been asked about notifications.
    static func undecided(_ done: @escaping (Bool) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let fresh = settings.authorizationStatus == .notDetermined
            DispatchQueue.main.async { done(fresh) }
        }
    }

    // MARK: Planning

    /// "2026-11-11T09:30", the phone's own time, as the page writes it.
    private static func parts(_ at: String) -> DateComponents? {
        let numbers = at.split(whereSeparator: { $0 == "-" || $0 == "T" || $0 == ":" }).map { Int($0) }
        guard numbers.count >= 5, let year = numbers[0], let month = numbers[1], let day = numbers[2],
              let hour = numbers[3], let minute = numbers[4] else { return nil }
        var out = DateComponents()
        out.calendar = calendar
        out.year = year
        out.month = month
        out.day = day
        out.hour = hour
        out.minute = minute
        return out
    }

    private static func minute(of date: Date) -> DateComponents {
        var out = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        out.calendar = calendar
        return out
    }

    private static func request(id: String, alarm: String, at: DateComponents, task: String, occ: String, title: String, body: String) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = ["task": task, "occ": occ, "alarm": alarm]
        if !task.isEmpty {
            content.categoryIdentifier = category
            content.threadIdentifier = task
        }
        return UNNotificationRequest(identifier: id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: at, repeats: false))
    }

    /// A time the page has stamped on a task, as against null, false or 0.
    private static func isSet(_ value: Any?) -> Bool {
        guard let value = value, !(value is NSNull) else { return false }
        if let number = value as? NSNumber { return number.boolValue }
        return true
    }

    /// Reminders still showing for tasks that are done or gone come down.
    static func clearShown(state: String) {
        guard let data = state.data(using: .utf8),
              let saved = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let tasks = saved["tasks"] as? [[String: Any]] else { return }
        // Each open task, with the date it has reached if it repeats.
        var reached: [String: String] = [:]
        for task in tasks {
            guard let id = task["id"] as? String, !isSet(task["done"]), !isSet(task["deleted"]) else { continue }
            let repeats = task["repeat"] is [String: Any]
            reached[id] = repeats ? (task["due"] as? String ?? "") : ""
        }
        let live = reached
        UNUserNotificationCenter.current().getDeliveredNotifications { shown in
            var ids: [String] = []
            for note in shown {
                let info = note.request.content.userInfo
                guard let task = info["task"] as? String, !task.isEmpty else { continue }
                let occ = info["occ"] as? String ?? ""
                if let due = live[task] {
                    // A repeating task ticked past this date.
                    if !due.isEmpty, !occ.isEmpty, occ < due { ids.append(note.request.identifier) }
                } else {
                    ids.append(note.request.identifier)
                }
            }
            if !ids.isEmpty { UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids) }
        }
    }

    /// Swaps everything waiting for the soonest of these.
    static func plan(_ alarms: [[String: Any]]) {
        lock.lock()
        // Kept so the plan can be topped up without the page: far more than fit is no use.
        write(Array(alarms.prefix(300)), "alarms.json")
        lock.unlock()
        schedule(alarms)
    }

    /// The last plan again, now that time has passed and some have rung.
    static func planAgain() {
        lock.lock()
        let alarms = rows("alarms.json")
        lock.unlock()
        schedule(alarms)
    }

    private typealias Ring = (when: Date, at: DateComponents, alarm: [String: Any])

    private static func nag(_ alarm: [String: Any]) -> Int { (alarm["nag"] as? NSNumber)?.intValue ?? 0 }

    private static func schedule(_ alarms: [[String: Any]]) {
        let now = Date()
        lock.lock()
        let seen = Set(rows("seen.json").compactMap { $0["id"] as? String })
        lock.unlock()
        var rings: [Ring] = []
        // Already rung, and set to keep nudging: its extra rings may still be to come.
        var rung: [Ring] = []
        for alarm in alarms {
            guard let id = alarm["id"] as? String, let text = alarm["at"] as? String, let at = parts(text),
                  let when = calendar.date(from: at) else { continue }
            if when > now {
                rings.append((when: when, at: at, alarm: alarm))
            } else if nag(alarm) > 0, !seen.contains(id) {
                rung.append((when: when, at: at, alarm: alarm))
            }
        }
        rings.sort { $0.when < $1.when }

        var requests: [UNNotificationRequest] = []
        var index: [[String: Any]] = []
        func add(_ id: String, _ at: DateComponents, _ alarm: [String: Any]) {
            let task = alarm["task"] as? String ?? ""
            let occ = alarm["occ"] as? String ?? ""
            requests.append(request(
                id: id, alarm: alarm["id"] as? String ?? id, at: at, task: task, occ: occ,
                title: alarm["title"] as? String ?? "", body: alarm["body"] as? String ?? ""
            ))
            // Summaries too, so Done on a reminder knows which of them are set.
            index.append(["id": id, "task": task, "occ": occ])
        }

        // The soonest reminders are certain of a place. What's left goes to the
        // extra rings of tasks that keep nudging, then to later reminders.
        let sure = min(rings.count, limit - heldForFollows)
        var spare = limit - sure
        for ring in rung + Array(rings.prefix(sure)) {
            let every = nag(ring.alarm)
            guard every > 0, let id = ring.alarm["id"] as? String else { continue }
            for n in 1...follows where spare > 0 {
                guard let later = calendar.date(byAdding: .minute, value: every * n, to: ring.when), later > now else { continue }
                add("\(id)#\(n)", minute(of: later), ring.alarm)
                spare -= 1
            }
        }
        var fit = Array(rings.prefix(sure + spare))
        // More than fits: the last place says so, rather than the reminders going quiet.
        let more = rings.count > fit.count && fit.count > 1
        if more { fit.removeLast() }
        for ring in fit {
            add(ring.alarm["id"] as? String ?? "", ring.at, ring.alarm)
        }
        if more, let last = fit.last {
            // Its own name: the page's notice about repeating reminders is "keep-going".
            let notice: [String: Any] = ["id": "keep-going-more", "title": "Open Nudge", "body": "Open the app to keep your reminders going."]
            add("keep-going-more", minute(of: last.when.addingTimeInterval(60)), notice)
        }

        lock.lock()
        write(index, "plan.json")
        lock.unlock()
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        for item in requests { center.add(item) }
    }

    // MARK: Taps on a reminder

    private static func remove(_ ids: [String]) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ids)
        center.removeDeliveredNotifications(withIdentifiers: ids)
    }

    /// The reminder was seen: its extra rings stop.
    static func quiet(alarm: String) {
        guard !alarm.isEmpty else { return }
        // Remembered, so planning again doesn't bring them back.
        lock.lock()
        write(Array((rows("seen.json").filter { ($0["id"] as? String) != alarm } + [["id": alarm]]).suffix(100)), "seen.json")
        lock.unlock()
        remove((1...follows).map { "\(alarm)#\($0)" })
    }

    /// Done: the page ticks the task off when it next runs, and nothing more rings for it.
    static func done(task: String, occ: String, alarm: String) {
        guard !task.isEmpty else { return }
        queue(["type": "done", "task": task, "occ": occ, "when": Int(Date().timeIntervalSince1970 * 1000)])
        lock.lock()
        let planned = rows("plan.json")
        lock.unlock()
        // A repeating task keeps the reminders of its later dates.
        var ids = planned
            .filter { ($0["task"] as? String) == task && ($0["occ"] as? String ?? "") <= occ }
            .compactMap { $0["id"] as? String }
        ids.append(alarm)
        ids.append("snooze|\(task)")
        remove(ids)
        quiet(alarm: alarm)
        recount(task: task, occ: occ)
    }

    /// A morning summary's title and line, worded as the page's summaryText words them.
    private static func summaryText(_ names: [String], count: Int) -> (title: String, body: String) {
        let word = count == 1 ? "task" : "tasks"
        return (title: "\(count) \(word) today", body: names.prefix(3).joined(separator: ", "))
    }

    /// Morning summaries stop counting a task that's done, as the page will once
    /// it hears. One with nothing left to count goes.
    private static func recount(task: String, occ: String) {
        let now = Date()
        let day = calendar.dateComponents([.year, .month, .day], from: now)
        let today = String(format: "%04d-%02d-%02d", day.year ?? 0, day.month ?? 0, day.day ?? 0)
        var alarms: [[String: Any]] = []
        var changed: [[String: Any]] = []
        var gone: [String] = []
        var touched = false
        lock.lock()
        let waiting = Set(rows("plan.json").compactMap { $0["id"] as? String })
        for alarm in rows("alarms.json") {
            // Each item is [task, the date that finishes it, title, due], as the page's summaryItem writes it.
            guard let id = alarm["id"] as? String, let items = alarm["items"] as? [[String]] else {
                alarms.append(alarm)
                continue
            }
            let left = items.filter { item in
                guard item.count >= 4, item[0] == task else { return true }
                // A one-off task is finished by any Done.
                if item[3].isEmpty { return false }
                // An old reminder, which the page ignores.
                if occ < item[3] { return true }
                // A repeating one is caught up to this date, or to today if that's later.
                return max(occ, today) < item[1]
            }
            if left.count == items.count {
                alarms.append(alarm)
                continue
            }
            touched = true
            let count = left.count + ((alarm["more"] as? NSNumber)?.intValue ?? 0)
            if count == 0 {
                gone.append(id)
                continue
            }
            let text = summaryText(left.compactMap { $0.count > 2 ? $0[2] : nil }, count: count)
            var fresh = alarm
            fresh["title"] = text.title
            fresh["body"] = text.body
            fresh["items"] = left
            alarms.append(fresh)
            if waiting.contains(id) { changed.append(fresh) }
        }
        if touched { write(alarms, "alarms.json") }
        lock.unlock()

        let center = UNUserNotificationCenter.current()
        if !gone.isEmpty { center.removePendingNotificationRequests(withIdentifiers: gone) }
        // Adding under the same name replaces the one waiting.
        for alarm in changed {
            guard let id = alarm["id"] as? String, let text = alarm["at"] as? String, let at = parts(text),
                  let when = calendar.date(from: at), when > now else { continue }
            center.add(request(
                id: id, alarm: id, at: at, task: "", occ: "",
                title: alarm["title"] as? String ?? "", body: alarm["body"] as? String ?? ""
            ))
        }
    }

    /// Rings again in a while. The page hears too, so the task shows it.
    static func snooze(task: String, occ: String, alarm: String, minutes: Int, title: String, body: String) {
        guard !task.isEmpty else { return }
        let now = Date()
        let until = now.addingTimeInterval(Double(minutes) * 60)
        queue([
            "type": "snooze", "task": task, "occ": occ,
            "until": Int(until.timeIntervalSince1970 * 1000), "when": Int(now.timeIntervalSince1970 * 1000),
        ])
        quiet(alarm: alarm)
        remove([alarm])
        let id = "snooze|\(task)"
        // On the minute, as the page will plan it.
        UNUserNotificationCenter.current().add(request(id: id, alarm: id, at: minute(of: until), task: task, occ: occ, title: title, body: body))
        lock.lock()
        write(rows("plan.json").filter { ($0["id"] as? String) != id } + [["id": id, "task": task, "occ": occ]], "plan.json")
        lock.unlock()
    }
}

/// Hears what was tapped on a reminder, with the app open or closed.
final class ReminderTaps: NSObject, UNUserNotificationCenterDelegate {
    // A reminder that comes due while the app is open still shows.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let content = response.notification.request.content
        let task = content.userInfo["task"] as? String ?? ""
        let occ = content.userInfo["occ"] as? String ?? ""
        let alarm = content.userInfo["alarm"] as? String ?? response.notification.request.identifier
        switch response.actionIdentifier {
        case "done":
            Reminders.done(task: task, occ: occ, alarm: alarm)
            Task { @MainActor in App.acted() }
        case "snooze10", "snooze60":
            let minutes = response.actionIdentifier == "snooze60" ? 60 : 10
            Reminders.snooze(task: task, occ: occ, alarm: alarm, minutes: minutes, title: content.title, body: content.body)
            Task { @MainActor in App.acted() }
        case UNNotificationDefaultActionIdentifier:
            Reminders.quiet(alarm: alarm)
            Task { @MainActor in App.open(task: task) }
        default:
            // Swiped away.
            Reminders.quiet(alarm: alarm)
        }
        completionHandler()
    }
}
