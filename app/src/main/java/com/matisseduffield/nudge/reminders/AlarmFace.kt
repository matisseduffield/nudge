package com.matisseduffield.nudge.reminders

import android.text.TextPaint
import android.text.format.DateFormat
import android.view.View
import android.widget.TextView
import com.matisseduffield.nudge.R
import java.time.LocalTime

/** What the alarm page shows, the same whether it's a page of its own or drawn over other apps. */
object AlarmFace {
    /** [use24] is the page's setting; alarms set by older versions don't have it, so their text, then the phone, decides. */
    fun bind(root: View, title: String, body: String, use24: Boolean?) {
        val hours24 = use24 ?: AlarmPlan.uses24(body) ?: DateFormat.is24HourFormat(root.context)
        val line = AlarmPlan.alarmLine(body, LocalTime.now(), hours24)
        val titleView = root.findViewById<TextView>(R.id.alarm_title)
        titleView.text = title
        fitLines(titleView)
        root.findViewById<TextView>(R.id.alarm_body).apply {
            text = line
            visibility = if (line.isEmpty()) View.GONE else View.VISIBLE
        }
        val clockView = root.findViewById<TextView>(R.id.alarm_time)
        (clockView.tag as? Clock)?.let { it.stop(); clockView.removeOnAttachStateChangeListener(it) }
        Clock(clockView, hours24).also {
            clockView.tag = it
            clockView.addOnAttachStateChangeListener(it)
            it.start()
        }
    }

    /** Puts the clock right, as when the screen wakes. */
    fun refresh(root: View) {
        (root.findViewById<TextView>(R.id.alarm_time)?.tag as? Clock)?.start()
    }

    fun stop(root: View) {
        (root.findViewById<TextView>(R.id.alarm_time)?.tag as? Clock)?.stop()
    }

    // The time moves on each minute while the page is up, and stops when it goes.
    private class Clock(private val view: TextView, private val use24: Boolean) : Runnable, View.OnAttachStateChangeListener {
        fun start() {
            view.removeCallbacks(this)
            run()
        }

        fun stop() {
            view.removeCallbacks(this)
        }

        override fun run() {
            val now = LocalTime.now()
            view.text = AlarmPlan.clock(now, use24)
            view.postDelayed(this, (60 - now.second) * 1000L - now.nano / 1_000_000 + 50)
        }

        override fun onViewAttachedToWindow(v: View) = start()
        override fun onViewDetachedFromWindow(v: View) = stop()
    }

    // As many lines as the title's box holds at its smallest size, at most 4, so a title
    // that can't fit ends in an ellipsis rather than being cut off. Matters in landscape,
    // and with large text.
    private fun fitLines(title: TextView) {
        if (title.tag != null) return
        title.tag = true
        title.addOnLayoutChangeListener { v, _, top, _, bottom, _, oldTop, _, oldBottom ->
            if (bottom - top == oldBottom - oldTop) return@addOnLayoutChangeListener
            val view = v as TextView
            val paint = TextPaint(view.paint).apply { textSize = view.autoSizeMinTextSize.toFloat() }
            val line = paint.getFontMetricsInt(null) * view.lineSpacingMultiplier + view.lineSpacingExtra
            val lines = ((bottom - top - view.totalPaddingTop - view.totalPaddingBottom) / line).toInt().coerceIn(1, 4)
            if (view.maxLines != lines) view.post { view.maxLines = lines }
        }
    }
}
