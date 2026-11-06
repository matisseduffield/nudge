package com.matisseduffield.nudge.reminders

import android.Manifest
import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.net.toUri
import com.matisseduffield.nudge.MainActivity
import com.matisseduffield.nudge.R
import com.matisseduffield.nudge.widget.TodayWidget
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/** Rings reminders with AlarmManager, whether or not the app is open. */
object Alarms {
    const val EXTRA_TASK = "task"
    const val EXTRA_ID = "id"
    const val ACTION_RING = "com.matisseduffield.nudge.RING"
    const val ACTION_DONE = "com.matisseduffield.nudge.DONE"
    const val ACTION_SNOOZE = "com.matisseduffield.nudge.SNOOZE"
    const val ACTION_DISMISS = "com.matisseduffield.nudge.DISMISS"
    const val EXTRA_MINUTES = "minutes"
    const val CHANNEL = "reminders"
    private const val EXTRA_OCC = "nudge.occ"
    private const val NOTIFICATION = 2
    private const val TEST_NOTIFICATION = 3
    private const val URGENT_CHANNEL = "urgent"
    private const val LOUD_NAG = 5
    private const val SUMMARY_CHANNEL = "summary"
    private const val SUMMARY_ID = 1
    private val lock = Any()

    fun canBeExact(context: Context): Boolean =
        Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    private fun millis(at: LocalDateTime) = at.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()

    private fun slot(context: Context, index: Int, id: String?): PendingIntent {
        // The slot is in the data, so each of the fifty is its own PendingIntent.
        val intent = Intent(context, ReminderReceiver::class.java)
            .setAction(ACTION_RING)
            .setData("nudge://alarm/$index".toUri())
            .putExtra(EXTRA_ID, id)
        return PendingIntent.getBroadcast(context, index, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** The page's new list. */
    fun replace(context: Context, array: JSONArray) = synchronized(lock) {
        val now = LocalDateTime.now()
        val tasks = openTasks(context)
        val fresh = (0 until array.length()).mapNotNull { i -> array.optJSONObject(i)?.let(Store::parse) }
        val kept = AlarmPlan.carriedOver(Store.readAlarms(context), fresh, now) { keep(it, tasks) }
        Store.writeAlarms(context, (fresh + kept).distinctBy { it.id })
        clearFinished(context, tasks)
        arm(context)
    }

    /** The tasks still to do, by id, from what the page last saved. */
    private fun openTasks(context: Context): Map<String, JSONObject> {
        val list = Store.readState(context)?.let { runCatching { JSONObject(it).optJSONArray("tasks") }.getOrNull() } ?: return emptyMap()
        return (0 until list.length()).mapNotNull { list.optJSONObject(it) }
            .filter { it.isNull("done") && it.isNull("deleted") }
            .associateBy { it.optString("id") }
    }

    private fun dueOf(task: JSONObject) = if (task.isNull("due")) "" else task.optString("due")

    // A repeating task's date has been ticked off once the task has moved past it. A
    // one-off task can only have been moved to another day, and is still to do.
    private fun current(task: JSONObject?, occ: String) = task != null &&
        (occ >= dueOf(task) || (task.isNull("repeat") && dueOf(task) <= LocalDate.now().toString()))

    // What survives a new list from the page. Nudging takes the task's latest title and
    // interval, and stops if that's been switched off.
    private fun keep(alarm: Alarm, tasks: Map<String, JSONObject>): Alarm? {
        if (alarm.summary) return alarm
        val task = tasks[alarm.task]
        if (!current(task, alarm.occ)) return null
        if (!AlarmPlan.isNag(alarm)) return alarm
        val loud = task!!.optBoolean("loud")
        val nag = task.optInt("nag").takeIf { it > 0 } ?: if (loud) LOUD_NAG else 0
        val reminders = task.optJSONArray("reminders")?.length() ?: 0
        return if (nag > 0 && reminders > 0) alarm.copy(title = task.optString("title"), nag = nag, loud = loud) else null
    }

    // A notification for something finished in the app shouldn't stay up.
    private fun clearFinished(context: Context, tasks: Map<String, JSONObject>) {
        val manager = context.getSystemService(NotificationManager::class.java)
        for (shown in manager.activeNotifications) {
            val task = shown.tag ?: continue
            val occ = shown.notification.extras.getString(EXTRA_OCC).orEmpty()
            val quietened = shown.notification.channelId == URGENT_CHANNEL && tasks[task]?.optBoolean("loud") != true
            if (!current(tasks[task], occ) || quietened) cancel(context, task)
        }
    }

    /** Sets the soonest alarms, and rings any that were missed. Safe to call any time. */
    fun arm(context: Context) = synchronized(lock) {
        val now = LocalDateTime.now()
        val all = Store.readAlarms(context)
        val missed = AlarmPlan.missed(all, now)
        missed.forEach { show(context, it) }
        // A missed alarm rang all the same, so Keep Nudging carries on from it.
        val kept = missed.fold(AlarmPlan.withoutPast(all, now)) { list, alarm -> AlarmPlan.afterRinging(list, alarm, now) }
        if (kept != all) Store.writeAlarms(context, kept)

        val manager = context.getSystemService(AlarmManager::class.java)
        val armed = AlarmPlan.toArm(kept, now)
        for (index in 0 until AlarmPlan.MAX_ARMED) {
            val alarm = armed.getOrNull(index)
            val intent = slot(context, index, alarm?.id)
            manager.cancel(intent)
            if (alarm == null) continue
            if (canBeExact(context)) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, millis(alarm.at), intent)
            else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, millis(alarm.at), intent)
        }
    }

    fun ring(context: Context, id: String?) = synchronized(lock) {
        val all = Store.readAlarms(context)
        val alarm = all.firstOrNull { it.id == id }
        if (alarm != null) {
            show(context, alarm)
            Store.writeAlarms(context, AlarmPlan.afterRinging(all, alarm, LocalDateTime.now()))
        }
        arm(context)
    }

    /** Rings through the same path as a real reminder, so it proves the whole chain. */
    fun test(context: Context, loud: Boolean) = synchronized(lock) {
        val body = if (loud) "This is how an urgent task rings." else "Your reminders are working."
        val alarm = Alarm(AlarmPlan.TEST_ID, "", "", LocalDateTime.now().plusMinutes(1), "Test reminder", body, 0, true, loud)
        Store.writeAlarms(context, Store.readAlarms(context).filter { it.id != alarm.id } + alarm)
        arm(context)
    }

    fun done(context: Context, task: String, occ: String) {
        synchronized(lock) {
            Store.writeAlarms(context, AlarmPlan.afterDone(Store.readAlarms(context), task, occ))
            cancel(context, task)
            arm(context)
        }
        TodayWidget.taskDone(context, task)
        Store.addAction(context, JSONObject().put("type", "done").put("task", task).put("occ", occ).put("when", System.currentTimeMillis()))
    }

    fun snooze(context: Context, task: String, occ: String, title: String, body: String, minutes: Long, loud: Boolean = false) {
        val until = LocalDateTime.now().plusMinutes(minutes)
        // Finished in the app since it rang: there's nothing to snooze.
        val saved = openTasks(context)[task]
        if (!current(saved, occ)) return cancel(context, task)
        // The snooze comes back as insistent as the reminder was.
        val nag = saved!!.optInt("nag").takeIf { it > 0 } ?: if (saved.optBoolean("loud")) LOUD_NAG else 0
        synchronized(lock) {
            val rung = Alarm(task, task, occ, until, title, body, nag, loud = loud)
            Store.writeAlarms(context, AlarmPlan.afterSnooze(Store.readAlarms(context), rung, until))
            cancel(context, task)
            arm(context)
        }
        Store.addAction(context, JSONObject().put("type", "snooze").put("task", task).put("occ", occ).put("until", millis(until)))
    }

    /** Dealt with on the full-screen page: stops the ringing and any nudging, and the task stays open. */
    fun stop(context: Context, task: String) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (task.isEmpty()) {
            manager.cancel(TEST_NOTIFICATION)
            AlarmOverlay.close(context, task)
            return AlarmActivity.close(task)
        }
        dismiss(context, task)
        cancel(context, task)
    }

    fun dismiss(context: Context, task: String) = synchronized(lock) {
        Store.writeAlarms(context, AlarmPlan.afterDismiss(Store.readAlarms(context), task))
        arm(context)
    }

    private fun requestCode(task: String) = task.hashCode() and 0x3fffffff

    private fun cancel(context: Context, task: String) {
        context.getSystemService(NotificationManager::class.java).cancel(task, NOTIFICATION)
        AlarmActivity.close(task)
        AlarmOverlay.close(context, task)
    }

    /** Whether an urgent task's notification is still up, for the page's queue. */
    fun ringing(context: Context, task: String) =
        context.getSystemService(NotificationManager::class.java).activeNotifications.any {
            if (task.isEmpty()) it.id == TEST_NOTIFICATION else it.tag == task
        }

    /** Whether the urgent channel exists and hasn't been switched off. */
    fun urgentChannelOn(context: Context): Boolean =
        context.getSystemService(NotificationManager::class.java).getNotificationChannel(URGENT_CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE

    private fun channels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH))
        manager.createNotificationChannel(NotificationChannel(SUMMARY_CHANNEL, "Morning summary", NotificationManager.IMPORTANCE_DEFAULT))
        // On the alarm stream, so it sounds with the phone on silent.
        manager.createNotificationChannel(
            NotificationChannel(URGENT_CHANNEL, "Urgent, rings like a call", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
                )
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 700, 500, 700, 500, 700)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            },
        )
    }

    // The full page, ringing over everything. Android shows it by itself on a locked
    // phone. On one in use it only shows a banner, so AlarmOverlay takes over there.
    private fun showLoud(context: Context, alarm: Alarm) {
        val test = alarm.id == AlarmPlan.TEST_ID
        val page = Intent(context, AlarmActivity::class.java)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
            .setData("nudge://ring/${alarm.task}".toUri())
            .putExtra(EXTRA_TASK, alarm.task)
            .putExtra("occ", alarm.occ)
            .putExtra("title", alarm.title)
            .putExtra("body", alarm.body)
            .putExtra("until", System.currentTimeMillis() + AlarmActivity.RING_MS)
        val full = PendingIntent.getActivity(context, requestCode(alarm.task) + 5, page, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = NotificationCompat.Builder(context, URGENT_CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(alarm.title)
            .setContentText(alarm.body)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setTimeoutAfter(AlarmActivity.RING_MS)
            .setContentIntent(full)
            .setFullScreenIntent(full, true)
            .addExtras(Bundle().apply { putString(EXTRA_OCC, alarm.occ) })
        if (!test) {
            builder
                .addAction(0, "Done", action(context, ACTION_DONE, alarm, 2))
                .addAction(0, "10 min", action(context, ACTION_SNOOZE, alarm, 3, 10))
                .addAction(0, "1 hour", action(context, ACTION_SNOOZE, alarm, 4, 60))
        }
        // Insistent repeats the sound until it's dealt with or the timeout above.
        val notification = builder.build().apply { flags = flags or android.app.Notification.FLAG_INSISTENT }
        val manager = context.getSystemService(NotificationManager::class.java)
        if (test) manager.notify(TEST_NOTIFICATION, notification) else manager.notify(alarm.task, NOTIFICATION, notification)
        // On a phone in use, Android would stop at a banner, so draw over the screen.
        val locked = context.getSystemService(KeyguardManager::class.java).isKeyguardLocked ||
            !context.getSystemService(PowerManager::class.java).isInteractive
        if (!locked && Settings.canDrawOverlays(context) && !AlarmOverlay.show(context, alarm)) {
            runCatching { context.startActivity(page) }
        }
    }

    private fun action(context: Context, name: String, alarm: Alarm, code: Int, minutes: Long = 0): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java)
            .setAction(name)
            .setData("nudge://task/${alarm.task}/$code".toUri())
            .putExtra(EXTRA_TASK, alarm.task)
            .putExtra("occ", alarm.occ)
            .putExtra("title", alarm.title)
            .putExtra("body", alarm.body)
            .putExtra(EXTRA_MINUTES, minutes)
            .putExtra("loud", alarm.loud)
        return PendingIntent.getBroadcast(context, requestCode(alarm.task) + code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun show(context: Context, alarm: Alarm) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        channels(context)
        if (alarm.loud) return showLoud(context, alarm)
        val open = Intent(context, MainActivity::class.java)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .setData("nudge://open/${alarm.task}".toUri())
            .putExtra(EXTRA_TASK, alarm.task)
        val tap = PendingIntent.getActivity(context, requestCode(alarm.task), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        // The test goes through the Reminders channel, so it shows what a real one would do.
        val test = alarm.id == AlarmPlan.TEST_ID
        val builder = NotificationCompat.Builder(context, if (alarm.summary && !test) SUMMARY_CHANNEL else CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(alarm.title)
            .setContentText(alarm.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(alarm.body))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .addExtras(Bundle().apply { putString(EXTRA_OCC, alarm.occ) })
        val manager = context.getSystemService(NotificationManager::class.java)
        if (alarm.summary) {
            manager.notify(if (test) TEST_NOTIFICATION else SUMMARY_ID, builder.build())
            return
        }
        builder
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDeleteIntent(action(context, ACTION_DISMISS, alarm, 1))
            .addAction(0, "Done", action(context, ACTION_DONE, alarm, 2))
            .addAction(0, "10 min", action(context, ACTION_SNOOZE, alarm, 3, 10))
            .addAction(0, "1 hour", action(context, ACTION_SNOOZE, alarm, 4, 60))
        manager.notify(alarm.task, NOTIFICATION, builder.build())
    }
}
