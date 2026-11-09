package com.matisseduffield.nudge.reminders

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.util.Locale

class AlarmPlanTest {
    private val now = LocalDateTime.of(2026, 11, 6, 10, 0)
    private fun alarm(id: String, task: String, occ: String, at: LocalDateTime, nag: Int = 0, summary: Boolean = false) =
        Alarm(id, task, occ, at, "T", "", nag, summary)

    @Test fun onlyTheSoonestAreSet() {
        val many = (1..80).map { alarm("a$it", "t$it", "", now.plusMinutes(it.toLong())) }.reversed()
        val armed = AlarmPlan.toArm(many, now)
        assertEquals(AlarmPlan.MAX_ARMED, armed.size)
        assertEquals("a1", armed.first().id)
    }

    @Test fun pastAlarmsAreNotSet() {
        val list = listOf(alarm("old", "t", "", now.minusMinutes(1)), alarm("new", "t", "", now.plusMinutes(1)))
        assertEquals(listOf("new"), AlarmPlan.toArm(list, now).map { it.id })
    }

    @Test fun recentMissedAlarmsRingButOldOnesDont() {
        val list = listOf(alarm("hour", "t", "", now.minusHours(1)), alarm("month", "t", "", now.minusDays(30)), alarm("later", "t", "", now.plusHours(1)))
        assertEquals(listOf("hour"), AlarmPlan.missed(list, now).map { it.id })
        assertEquals(listOf("later"), AlarmPlan.withoutPast(list, now).map { it.id })
    }

    @Test fun ringingRemovesTheAlarm() {
        val a = alarm("a", "t", "", now)
        assertTrue(AlarmPlan.afterRinging(listOf(a), a, now).isEmpty())
    }

    @Test fun keepNudgingLinesUpTheNextOne() {
        val a = alarm("a", "t", "d", now, nag = 15)
        val first = AlarmPlan.afterRinging(listOf(a), a, now)
        assertEquals(listOf("t#nag"), first.map { it.id })
        assertEquals(now.plusMinutes(15), first.single().at)
        // And again, without piling up.
        val second = AlarmPlan.afterRinging(first, first.single(), now.plusMinutes(15))
        assertEquals(listOf("t#nag"), second.map { it.id })
        assertEquals(now.plusMinutes(30), second.single().at)
    }

    @Test fun aLoudTaskStaysLoudWhenItNudges() {
        val a = alarm("a", "t", "d", now, nag = 5).copy(loud = true)
        assertTrue(AlarmPlan.afterRinging(listOf(a), a, now).single().loud)
    }

    @Test fun aSummaryNeverNudges() {
        val a = alarm("s", "", "", now, nag = 15, summary = true)
        assertTrue(AlarmPlan.afterRinging(listOf(a), a, now).isEmpty())
    }

    @Test fun doneClearsThisOccurrenceOnly() {
        val list = listOf(
            alarm("a", "t", "2026-11-06", now.plusHours(1)),
            alarm("t#nag", "t", "2026-11-05", now.plusHours(2)),
            alarm("c", "t", "2026-11-13", now.plusDays(7)),
            alarm("d", "other", "2026-11-06", now.plusHours(1)),
        )
        assertEquals(listOf("c", "d"), AlarmPlan.afterDone(list, "t", "2026-11-06", now.toLocalDate()).map { it.id })
    }

    @Test fun twoRemindersMakeOneChainOfNudges() {
        val a = alarm("a", "t", "d", now, nag = 5)
        val b = alarm("b", "t", "d", now, nag = 5)
        val list = AlarmPlan.afterRinging(AlarmPlan.afterRinging(listOf(a, b), a, now), b, now)
        assertEquals(listOf("t#nag"), list.map { it.id })
    }

    @Test fun missedAlarmsAndNudgingSurviveANewList() {
        val due = alarm("due", "t", "d", now.minusMinutes(5))
        val nag = alarm("t#nag", "t", "d", now.plusMinutes(5), nag = 5)
        val later = alarm("later", "t", "d", now.plusHours(1))
        val kept = AlarmPlan.carriedOver(listOf(due, nag, later), emptyList(), now) { it }
        assertEquals(listOf("due", "t#nag"), kept.map { it.id })
        // A task finished since doesn't keep them.
        assertTrue(AlarmPlan.carriedOver(listOf(due, nag), emptyList(), now) { null }.isEmpty())
        // Nor does an alarm the page has sent again.
        assertEquals(listOf("t#nag"), AlarmPlan.carriedOver(listOf(due, nag), listOf(due), now) { it }.map { it.id })
    }

    @Test fun aNewTimeThatDayStopsTheNudging() {
        val nag = alarm("t#nag", "t", "2026-11-06", now.plusMinutes(5), nag = 5)
        val other = alarm("u#nag", "u", "2026-11-06", now.plusMinutes(5), nag = 5)
        // Moved from 9am to 5pm: it rings at 5, not every 5 minutes till then.
        val moved = alarm("t|2026-11-06T17:00", "t", "2026-11-06", now.withHour(17))
        assertEquals(listOf("u#nag"), AlarmPlan.carriedOver(listOf(nag, other), listOf(moved), now) { it }.map { it.id })
        assertEquals(setOf("t" to "2026-11-06"), AlarmPlan.rescheduled(listOf(nag, other), listOf(moved), now))
        // A later reminder it already had is no reason to stop.
        assertEquals(listOf("t#nag"), AlarmPlan.carriedOver(listOf(nag, moved), listOf(moved), now) { it }.map { it.id })
        assertTrue(AlarmPlan.rescheduled(listOf(nag, moved), listOf(moved), now).isEmpty())
        // Nor is a new time on another date.
        val tomorrow = alarm("t|2026-11-07T09:00", "t", "2026-11-07", now.plusDays(1))
        assertEquals(listOf("t#nag"), AlarmPlan.carriedOver(listOf(nag), listOf(tomorrow), now) { it }.map { it.id })
    }

    @Test fun aMissedReminderFromAnEarlierDaySaysItsDate() {
        val today = alarm("a", "t", "2026-11-06", now.minusHours(1)).copy(body = "Today, 9am")
        assertEquals("Today, 9am", AlarmPlan.missedNotice(today, now)!!.body)
        val yesterday = alarm("b", "t", "2026-11-05", now.minusDays(1)).copy(body = "Today, 5pm")
        assertEquals("Thu 5 Nov, 5pm", AlarmPlan.missedNotice(yesterday, now)!!.body)
        val noTime = alarm("c", "t", "2026-11-05", now.minusDays(1)).copy(body = "Today")
        assertEquals("Thu 5 Nov", AlarmPlan.missedNotice(noTime, now)!!.body)
        val newYear = LocalDateTime.of(2027, 1, 1, 9, 0)
        val lastYear = alarm("d", "t", "2026-12-31", newYear.minusDays(1)).copy(body = "Today, 5pm")
        assertEquals("Thu 31 Dec 2026, 5pm", AlarmPlan.missedNotice(lastYear, newYear)!!.body)
    }

    @Test fun aMorningSummaryFromAnEarlierDayIsLeftOut() {
        val old = alarm("summary|2026-11-05", "", "", now.minusDays(1), summary = true)
        val fresh = alarm("summary|2026-11-06", "", "", now.minusHours(2), summary = true)
        val keepGoing = alarm("keep-going", "", "", now.minusDays(1), summary = true)
        assertNull(AlarmPlan.missedNotice(old, now))
        assertEquals(fresh, AlarmPlan.missedNotice(fresh, now))
        assertEquals(keepGoing, AlarmPlan.missedNotice(keepGoing, now))
    }

    @Test fun dismissStopsNudgingAndNothingElse() {
        val list = listOf(alarm("a#nag", "t", "d", now.plusHours(1)), alarm("b", "t", "d", now.plusHours(2)))
        assertEquals(listOf("b"), AlarmPlan.afterDismiss(list, "t").map { it.id })
    }

    @Test fun snoozingStopsNudgingAndRingsOnceLater() {
        val a = alarm("a#nag", "t", "d", now.plusMinutes(5), nag = 5)
        val until = now.plusHours(1)
        val once = AlarmPlan.afterSnooze(listOf(a), a, until)
        assertEquals(listOf("t#snooze"), once.map { it.id })
        assertEquals(until, once.single().at)
        // Snoozing twice leaves one.
        assertEquals(1, AlarmPlan.afterSnooze(once, a, until.plusHours(1)).size)
    }

    @Test fun theClockShowsMinutesEitherWay() {
        assertEquals("3:00pm", AlarmPlan.clock(LocalTime.of(15, 0), false))
        assertEquals("12:05am", AlarmPlan.clock(LocalTime.of(0, 5), false))
        assertEquals("12:30pm", AlarmPlan.clock(LocalTime.of(12, 30), false))
        assertEquals("15:00", AlarmPlan.clock(LocalTime.of(15, 0), true))
        assertEquals("09:30", AlarmPlan.clock(LocalTime.of(9, 30), true))
    }

    @Test fun theClockFollowsThePagesSetting() {
        assertEquals(false, AlarmPlan.uses24("Today, 3pm"))
        assertEquals(false, AlarmPlan.uses24("Tomorrow, 9:30am"))
        assertEquals(true, AlarmPlan.uses24("Today, 15:00"))
        assertNull(AlarmPlan.uses24("Today"))
        assertNull(AlarmPlan.uses24("Mon 9 Nov"))
    }

    @Test fun todayAtTheTimeOnTheClockGoes() {
        assertEquals("", AlarmPlan.alarmLine("Today, 3pm", LocalTime.of(15, 0, 20), false))
        assertEquals("", AlarmPlan.alarmLine("Today, 3:30pm", LocalTime.of(15, 30), false))
        assertEquals("", AlarmPlan.alarmLine("Today, 15:00", LocalTime.of(15, 0), true))
        assertEquals("", AlarmPlan.alarmLine("Today", LocalTime.of(9, 0), false))
    }

    @Test fun anotherDayOrTimeStays() {
        // Half an hour ahead, or snoozed: the task's own time still matters.
        assertEquals("Today, 3pm", AlarmPlan.alarmLine("Today, 3pm", LocalTime.of(14, 30), false))
        assertEquals("Tomorrow, 9am", AlarmPlan.alarmLine("Tomorrow, 9am", LocalTime.of(9, 0), false))
        assertEquals("Mon 9 Nov, 3pm", AlarmPlan.alarmLine("Mon 9 Nov, 3pm", LocalTime.of(15, 0), false))
    }

    private val today = now.toLocalDate()
    private fun summary(day: String, vararg items: Counted, more: Int = 0) =
        AlarmPlan.summaryText(items.map { it.title }, items.size + more).let { (title, body) ->
            Alarm("summary|$day", "", "", LocalDate.parse(day).atTime(8, 0), title, body, 0, summary = true, items = items.toList(), more = more)
        }

    @Test fun doneTakesATaskOffTheMorningSummary() {
        val sum = summary("2026-11-07", Counted("a", "2026-11-05", "Pay rent"), Counted("b", "2026-11-07", "Gym"), Counted("c", "2026-11-07", "Call mum"), Counted("d", "2026-11-07", "Bins"))
        assertEquals("4 tasks today", sum.title)
        assertEquals("Pay rent, Gym, Call mum", sum.body)
        // A one-off task is finished by Done, whichever notification it was on.
        val after = AlarmPlan.afterDone(listOf(sum), "a", "2026-11-05", today).single()
        assertEquals("3 tasks today", after.title)
        assertEquals("Gym, Call mum, Bins", after.body)
        assertEquals(listOf("b", "c", "d"), after.items.map { it.task })
        assertEquals("1 task today", AlarmPlan.afterDone(AlarmPlan.afterDone(listOf(after), "b", "2026-11-07", today), "c", "2026-11-07", today).single().title)
    }

    @Test fun aLaterDateOfARepeatingTaskStaysCounted() {
        // Friday the 6th: ticking off today's walk leaves tomorrow's for tomorrow's summary.
        val sum = summary("2026-11-07", Counted("daily", "2026-11-07", "Walk", due = "2026-11-06"))
        assertEquals(listOf(sum), AlarmPlan.afterDone(listOf(sum), "daily", "2026-11-06", today))
    }

    @Test fun weeklyBinsTickedOnTheirDayLeaveTheWeeksSummaries() {
        // Bins every Monday, due 2 Nov and never ticked. Done on Monday 9 Nov's reminder.
        val days = (10..16).map { "2026-11-$it" }
        val sums = days.map { day -> summary(day, Counted("bins", if (day < "2026-11-16") "2026-11-09" else "2026-11-16", "Bins", due = "2026-11-02"), Counted("x", day, "Other")) }
        val after = AlarmPlan.afterDone(sums, "bins", "2026-11-09", LocalDate.of(2026, 11, 9))
        assertEquals(days.map { if (it < "2026-11-16") listOf("x") else listOf("bins", "x") }, after.map { s -> s.items.map { it.task } })
        assertEquals("1 task today", after.first().title)
    }

    @Test fun anOverdueRepeatingTaskTickedTodayLeavesTodaysSummary() {
        // Daily since 7 Nov, ticked on the 7th's notification at 7:30 on the 9th: the page
        // catches it up past today, so the 8:00 summary that day no longer counts it.
        val nine = summary("2026-11-09", Counted("walk", "2026-11-09", "Walk", due = "2026-11-07"))
        val ten = summary("2026-11-10", Counted("walk", "2026-11-10", "Walk", due = "2026-11-07"))
        val after = AlarmPlan.afterDone(listOf(nine, ten), "walk", "2026-11-07", LocalDate.of(2026, 11, 9))
        assertEquals(listOf("summary|2026-11-10"), after.map { it.id })
    }

    @Test fun anOldNotificationDoesNotTakeOffANewerDate() {
        // The page ignores Done on a date from before the task's date then.
        val sum = summary("2026-11-10", Counted("walk", "2026-11-10", "Walk", due = "2026-11-09"))
        assertEquals(listOf(sum), AlarmPlan.afterDone(listOf(sum), "walk", "2026-11-08", LocalDate.of(2026, 11, 10)))
    }

    @Test fun aSummaryWithNothingLeftGoes() {
        val sum = summary("2026-11-07", Counted("a", "2026-11-07", "Gym"))
        val other = summary("2026-11-08", Counted("a", "2026-11-07", "Gym"), Counted("b", "2026-11-08", "Bins"))
        val keepGoing = alarm("keep-going", "", "", now.plusDays(14), summary = true)
        val left = AlarmPlan.afterDone(listOf(sum, other, keepGoing), "a", "2026-11-07", today)
        assertEquals(listOf("summary|2026-11-08", "keep-going"), left.map { it.id })
        assertEquals("1 task today", left.first().title)
        assertEquals("Bins", left.first().body)
    }

    @Test fun tasksPastTheListStillCount() {
        val sum = summary("2026-11-07", Counted("a", "2026-11-07", "Gym"), more = 4)
        assertEquals("5 tasks today", sum.title)
        val after = AlarmPlan.afterDone(listOf(sum), "a", "2026-11-07", today).single()
        assertEquals("4 tasks today", after.title)
        assertEquals("", after.body)
    }

    @Test fun theBackstopGoesOffWithTheSoonestAlarm() {
        val list = listOf(alarm("later", "t", "", now.plusHours(2)), alarm("old", "t", "", now.minusMinutes(1)), alarm("soon", "u", "", now.plusMinutes(10)))
        assertEquals(now.plusMinutes(10), AlarmPlan.backstop(list, now))
        assertNull(AlarmPlan.backstop(listOf(alarm("old", "t", "", now.minusMinutes(1))), now))
    }

    @Test fun aReminderTheExactAlarmRangIsNotShownAgainByTheBackstop() {
        val a = alarm("a", "t", "d", now)
        val b = alarm("b", "u", "d", now.plusHours(1))
        // The exact alarm rings first and takes it off the list...
        val list = AlarmPlan.afterRinging(listOf(a, b), a, now)
        // ...so when the backstop runs arm(), there's nothing missed to show.
        assertTrue(AlarmPlan.missed(list, now.plusMinutes(1)).isEmpty())
        assertEquals(now.plusHours(1), AlarmPlan.backstop(list, now.plusMinutes(1)))
        // And with exact alarms gone, the backstop shows it, late, once.
        val late = now.plusMinutes(20)
        assertEquals(listOf("a"), AlarmPlan.missed(listOf(a, b), late).map { it.id })
        assertTrue(AlarmPlan.missed(AlarmPlan.withoutPast(listOf(a, b), late), late).isEmpty())
    }

    @Test fun theClockUsesPlainDigitsInAnyLanguage() {
        val was = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("ar-EG"))
            assertEquals("09:05", AlarmPlan.clock(LocalTime.of(9, 5), true))
            assertEquals("9:05am", AlarmPlan.clock(LocalTime.of(9, 5), false))
            assertEquals("", AlarmPlan.alarmLine("Today, 9:05am", LocalTime.of(9, 5), false))
        } finally {
            Locale.setDefault(was)
        }
    }
}
