package com.matisseduffield.nudge.reminders

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime

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
        assertEquals(listOf("a#nag"), first.map { it.id })
        assertEquals(now.plusMinutes(15), first.single().at)
        // And again, without piling up.
        val second = AlarmPlan.afterRinging(first, first.single(), now.plusMinutes(15))
        assertEquals(listOf("a#nag"), second.map { it.id })
        assertEquals(now.plusMinutes(30), second.single().at)
    }

    @Test fun aSummaryNeverNudges() {
        val a = alarm("s", "", "", now, nag = 15, summary = true)
        assertTrue(AlarmPlan.afterRinging(listOf(a), a, now).isEmpty())
    }

    @Test fun doneClearsThisOccurrenceOnly() {
        val list = listOf(
            alarm("a", "t", "2026-11-06", now.plusHours(1)),
            alarm("b#nag", "t", "2026-11-06", now.plusHours(2)),
            alarm("c", "t", "2026-11-13", now.plusDays(7)),
            alarm("d", "other", "2026-11-06", now.plusHours(1)),
        )
        assertEquals(listOf("c", "d"), AlarmPlan.afterDone(list, "t", "2026-11-06").map { it.id })
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
}
