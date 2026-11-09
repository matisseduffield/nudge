package com.matisseduffield.nudge.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.matisseduffield.nudge.widget.TodayWidget

/** An alarm ringing, or a tap on a notification. Runs before the first unlock too (directBootAware). */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val task = intent.getStringExtra(Alarms.EXTRA_TASK).orEmpty()
        when (intent.action) {
            Alarms.ACTION_RING -> Alarms.ring(context, intent.getStringExtra(Alarms.EXTRA_ID))
            Alarms.ACTION_DONE -> Alarms.done(context, task, intent.getStringExtra("occ").orEmpty())
            Alarms.ACTION_SNOOZE -> Alarms.snooze(
                context,
                task,
                intent.getStringExtra("occ").orEmpty(),
                intent.getStringExtra("title").orEmpty(),
                intent.getStringExtra("body").orEmpty(),
                intent.getLongExtra(Alarms.EXTRA_MINUTES, 10),
                intent.getBooleanExtra("loud", false),
                intent.getIntExtra("nag", 0),
            )
            Alarms.ACTION_DISMISS -> Alarms.dismiss(context, task)
        }
    }
}

/**
 * The phone restarted, the app updated, or the clock moved: set everything again.
 * After a restart that happens before the phone is unlocked, so reminders ring from the start.
 */
class SystemReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            // Sent once the phone is unlocked. Anything ticked off before then joins the usual queue.
            Intent.ACTION_BOOT_COMPLETED -> {
                val locked = Store.moveLockedActions(context)
                for (i in 0 until locked.length()) {
                    val action = locked.optJSONObject(i) ?: continue
                    if (action.optString("type") == "done") TodayWidget.taskDone(context, action.optString("task"), action.optString("occ"))
                }
                Alarms.arm(context, reset = true)
            }
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED",
            -> Alarms.arm(context, reset = true)
        }
    }
}
