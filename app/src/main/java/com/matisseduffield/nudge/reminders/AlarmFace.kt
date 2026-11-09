package com.matisseduffield.nudge.reminders

import android.text.format.DateFormat
import android.view.View
import android.widget.TextView
import com.matisseduffield.nudge.R
import java.time.LocalTime

/** What the alarm page shows, the same whether it's a page of its own or drawn over other apps. */
object AlarmFace {
    fun bind(root: View, title: String, body: String) {
        // The page's 24-hour setting shows in the time it wrote; without one, the phone's.
        val use24 = AlarmPlan.uses24(body) ?: DateFormat.is24HourFormat(root.context)
        val line = AlarmPlan.alarmLine(body, LocalTime.now(), use24)
        root.findViewById<TextView>(R.id.alarm_title).text = title
        root.findViewById<TextView>(R.id.alarm_body).apply {
            text = line
            visibility = if (line.isEmpty()) View.GONE else View.VISIBLE
        }
        keepTime(root.findViewById(R.id.alarm_time), use24)
    }

    // The clock moves on each minute for as long as the page is up.
    private fun keepTime(clock: TextView, use24: Boolean) {
        (clock.tag as? Runnable)?.let(clock::removeCallbacks)
        val untilNextMinute = { now: LocalTime -> (60 - now.second) * 1000L - now.nano / 1_000_000 + 50 }
        val tick = object : Runnable {
            override fun run() {
                if (!clock.isAttachedToWindow) return
                val now = LocalTime.now()
                clock.text = AlarmPlan.clock(now, use24)
                clock.postDelayed(this, untilNextMinute(now))
            }
        }
        clock.tag = tick
        val now = LocalTime.now()
        clock.text = AlarmPlan.clock(now, use24)
        clock.postDelayed(tick, untilNextMinute(now))
    }
}
