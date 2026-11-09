package com.matisseduffield.nudge.reminders

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** One reminder the page has asked for. [at] is local time, so it follows the phone across time zones. */
data class Alarm(
    val id: String,
    val task: String,
    val occ: String,
    val at: LocalDateTime,
    val title: String,
    val body: String,
    val nag: Int,
    val summary: Boolean = false,
    val loud: Boolean = false,
)

/** What happens to the list of alarms, kept free of Android so it can be tested on its own. */
object AlarmPlan {
    const val MAX_ARMED = 50
    private const val NAG_SUFFIX = "#nag"
    private const val SUMMARY_PREFIX = "summary|"   // the page's morning summaries
    private const val SNOOZE_SUFFIX = "#snooze"
    private const val MISSED_DAYS = 3L

    fun sorted(list: List<Alarm>) = list.sortedBy { it.at }

    /** The soonest alarms still to come. Android allows only so many, and more are set as these ring. */
    fun toArm(list: List<Alarm>, now: LocalDateTime) = sorted(list).filter { it.at.isAfter(now) }.take(MAX_ARMED)

    /** Alarms whose time passed while they couldn't ring, such as with the phone off. */
    fun missed(list: List<Alarm>, now: LocalDateTime) =
        sorted(list).filter { !it.at.isAfter(now) && it.at.isAfter(now.minusDays(MISSED_DAYS)) }

    /**
     * What a missed alarm shows, if anything. One from an earlier day can't say "Today"
     * any more: a morning summary is out of date and goes, and a reminder gives its date.
     */
    fun missedNotice(alarm: Alarm, now: LocalDateTime): Alarm? {
        if (!alarm.at.toLocalDate().isBefore(now.toLocalDate())) return alarm
        if (alarm.summary) return if (alarm.id.startsWith(SUMMARY_PREFIX)) null else alarm
        val day = runCatching { LocalDate.parse(alarm.occ) }.getOrNull() ?: return alarm
        val date = day.format(DateTimeFormatter.ofPattern(if (day.year == now.year) "EEE d MMM" else "EEE d MMM yyyy", Locale.ENGLISH))
        // The page writes the day, then the time if there is one.
        val time = alarm.body.substringAfter(", ", "")
        return alarm.copy(body = listOf(date, time).filter { it.isNotEmpty() }.joinToString(", "))
    }

    /** Past alarms are finished with, once [missed] has had them. */
    fun withoutPast(list: List<Alarm>, now: LocalDateTime) = list.filter { it.at.isAfter(now) }

    fun isNag(alarm: Alarm) = alarm.id.endsWith(NAG_SUFFIX)

    /** After one rings it's gone, and Keep Nudging lines up the next: one chain per task. */
    fun afterRinging(list: List<Alarm>, rung: Alarm, now: LocalDateTime): List<Alarm> {
        val rest = list.filter { it.id != rung.id }
        if (rung.nag <= 0 || rung.summary) return rest
        val again = rung.copy(id = rung.task + NAG_SUFFIX, at = now.plusMinutes(rung.nag.toLong()))
        return rest.filter { it.id != again.id } + again
    }

    /** Done clears this occurrence and any nudging. A repeating task's later dates stay set. */
    fun afterDone(list: List<Alarm>, task: String, occ: String) =
        list.filter { it.task != task || (it.occ != occ && !isNag(it)) }

    /** Dismissing stops the nudging, and leaves any other reminders alone. */
    fun afterDismiss(list: List<Alarm>, task: String) = list.filter { it.task != task || !isNag(it) }

    /**
     * Alarms the phone must keep when the page sends a new list: ones due but not rung yet,
     * and nudging. Not for a task date the page has just given a new time, though: that
     * one rings when it's now meant to.
     */
    fun carriedOver(old: List<Alarm>, fresh: List<Alarm>, now: LocalDateTime, keep: (Alarm) -> Alarm?): List<Alarm> {
        val ids = fresh.map { it.id }.toSet()
        val moved = rescheduled(old, fresh, now)
        return old.filter { it.id !in ids && (isNag(it) || !it.at.isAfter(now)) && (it.summary || (it.task to it.occ) !in moved) }
            .mapNotNull(keep)
    }

    /** Task dates, as (task, occ), that the page's new list gives a time to ring the phone didn't have. */
    fun rescheduled(old: List<Alarm>, fresh: List<Alarm>, now: LocalDateTime): Set<Pair<String, String>> {
        val had = old.map { it.id }.toSet()
        return fresh.filter { !it.summary && it.id !in had && it.at.isAfter(now) }.map { it.task to it.occ }.toSet()
    }

    /** Snoozing replaces the nudging with one alarm later on. */
    fun afterSnooze(list: List<Alarm>, rung: Alarm, until: LocalDateTime): List<Alarm> {
        val rest = afterDismiss(list, rung.task).filter { it.id != rung.task + SNOOZE_SUFFIX }
        return rest + rung.copy(id = rung.task + SNOOZE_SUFFIX, at = until)
    }
}
