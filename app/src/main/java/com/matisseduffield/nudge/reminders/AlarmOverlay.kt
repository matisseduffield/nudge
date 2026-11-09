package com.matisseduffield.nudge.reminders

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.ContextThemeWrapper
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import com.matisseduffield.nudge.R

/**
 * The alarm page drawn straight over whatever's on screen. On a phone in use, Android
 * turns a full-screen alert into a banner, and phone makers often block apps from
 * opening a page by themselves, so this draws a window of its own instead. It needs
 * Show over other apps. A locked phone gets [AlarmActivity].
 */
object AlarmOverlay {
    private val main = Handler(Looper.getMainLooper())
    private val waiting = ArrayDeque<Alarm>()
    private var view: View? = null
    private var alarm: Alarm? = null

    private fun manager(context: Context) = context.applicationContext.getSystemService(WindowManager::class.java)

    /** Puts the page up, and says whether it could. */
    fun show(context: Context, next: Alarm): Boolean {
        val app = context.applicationContext
        if (view != null) {
            if (alarm?.task == next.task) bind(app, next) else if (waiting.none { it.task == next.task }) waiting.addLast(next)
            return true
        }
        val themed = ContextThemeWrapper(app, R.style.Theme_Nudge_Alarm)
        val root = LayoutInflater.from(themed).inflate(R.layout.activity_alarm, null)
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            PixelFormat.OPAQUE,
        )
        if (Build.VERSION.SDK_INT >= 28) {
            params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        return runCatching {
            manager(app).addView(root, params)
            view = root
            bind(app, next)
            true
        }.getOrDefault(false)
    }

    private fun bind(context: Context, next: Alarm) {
        val root = view ?: return
        alarm = next
        AlarmFace.bind(root, next.title, next.body, next.use24)
        root.findViewById<View>(R.id.alarm_done).setOnClickListener { Alarms.done(context, next.task, next.occ) }
        root.findViewById<View>(R.id.alarm_ten).setOnClickListener { snooze(context, next, 10) }
        root.findViewById<View>(R.id.alarm_hour).setOnClickListener { snooze(context, next, 60) }
        root.findViewById<View>(R.id.alarm_stop).setOnClickListener { Alarms.stop(context, next.task) }
        // Left alone, it goes when the ringing does, and nudging brings it back.
        main.removeCallbacksAndMessages(null)
        main.postDelayed({ advance(context) }, AlarmActivity.RING_MS)
    }

    private fun snooze(context: Context, rung: Alarm, minutes: Long) =
        Alarms.snooze(context, rung.task, rung.occ, rung.title, rung.body, minutes, true, rung.nag, rung.use24)

    /** The task's been dealt with, here or anywhere else. */
    fun close(context: Context, task: String) {
        main.post {
            waiting.removeAll { it.task == task }
            if (view != null && alarm?.task == task) advance(context)
        }
    }

    // On to the next one still ringing, or away.
    private fun advance(context: Context) {
        while (waiting.isNotEmpty()) {
            val up = waiting.removeFirst()
            if (Alarms.ringing(context, up.task)) return bind(context.applicationContext, up)
        }
        main.removeCallbacksAndMessages(null)
        view?.let { runCatching { manager(context).removeView(it) } }
        view = null
        alarm = null
    }
}
