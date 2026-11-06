package com.matisseduffield.nudge.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** An alarm ringing, or a tap on a notification. */
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
            )
            Alarms.ACTION_DISMISS -> Alarms.dismiss(context, task)
        }
    }
}

/** The phone restarted, the app updated, or the clock moved: set everything again. */
class SystemReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED",
            -> Alarms.arm(context)
        }
    }
}
