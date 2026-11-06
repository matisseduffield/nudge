package com.matisseduffield.nudge.reminders

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.net.toUri
import com.matisseduffield.nudge.MainActivity
import com.matisseduffield.nudge.R
import org.json.JSONArray
import org.json.JSONObject
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
    private const val CHANNEL = "reminders"
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
        val fresh = (0 until array.length()).mapNotNull { i -> array.optJSONObject(i)?.let(Store::parse) }
        // Nudging and snoozes in progress belong to the phone, unless the page has taken them over.
        val mine = Store.readAlarms(context).filter { it.id.endsWith("#nag") }
            .filter { old -> fresh.any { it.task == old.task && it.occ == old.occ } || old.task.isNotEmpty() && stillOpen(context, old) }
        Store.writeAlarms(context, fresh + mine)
        arm(context)
    }

    // Nudging stops as soon as the task isn't open any more.
    private fun stillOpen(context: Context, alarm: Alarm): Boolean {
        val tasks = Store.readState(context)?.let { runCatching { JSONObject(it).optJSONArray("tasks") }.getOrNull() } ?: return false
        for (i in 0 until tasks.length()) {
            val task = tasks.optJSONObject(i) ?: continue
            if (task.optString("id") != alarm.task) continue
            return task.isNull("done") && task.isNull("deleted") && task.optString("due") == alarm.occ
        }
        return false
    }

    /** Sets the soonest alarms, and rings any that were missed. Safe to call any time. */
    fun arm(context: Context) = synchronized(lock) {
        val now = LocalDateTime.now()
        val all = Store.readAlarms(context)
        AlarmPlan.missed(all, now).forEach { show(context, it) }
        val kept = AlarmPlan.withoutPast(all, now)
        if (kept.size != all.size) Store.writeAlarms(context, kept)

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

    fun done(context: Context, task: String, occ: String) {
        synchronized(lock) {
            Store.writeAlarms(context, AlarmPlan.afterDone(Store.readAlarms(context), task, occ))
            cancel(context, task)
            arm(context)
        }
        Store.addAction(context, JSONObject().put("type", "done").put("task", task).put("occ", occ).put("when", System.currentTimeMillis()))
    }

    fun snooze(context: Context, task: String, occ: String, title: String, body: String, minutes: Long) {
        val until = LocalDateTime.now().plusMinutes(minutes)
        synchronized(lock) {
            val rung = Alarm(task, task, occ, until, title, body, 0)
            Store.writeAlarms(context, AlarmPlan.afterSnooze(Store.readAlarms(context), rung, until))
            cancel(context, task)
            arm(context)
        }
        Store.addAction(context, JSONObject().put("type", "snooze").put("task", task).put("until", millis(until)))
    }

    fun dismiss(context: Context, task: String) = synchronized(lock) {
        Store.writeAlarms(context, AlarmPlan.afterDismiss(Store.readAlarms(context), task))
        arm(context)
    }

    private fun notificationId(task: String) = task.hashCode() or 0x40000000

    private fun cancel(context: Context, task: String) {
        context.getSystemService(NotificationManager::class.java).cancel(notificationId(task))
    }

    private fun channels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH))
        manager.createNotificationChannel(NotificationChannel(SUMMARY_CHANNEL, "Morning summary", NotificationManager.IMPORTANCE_DEFAULT))
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
        return PendingIntent.getBroadcast(context, notificationId(alarm.task) + code, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun show(context: Context, alarm: Alarm) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        channels(context)
        val open = Intent(context, MainActivity::class.java)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .setData("nudge://open/${alarm.task}".toUri())
            .putExtra(EXTRA_TASK, alarm.task)
        val tap = PendingIntent.getActivity(context, notificationId(alarm.task), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = NotificationCompat.Builder(context, if (alarm.summary) SUMMARY_CHANNEL else CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(alarm.title)
            .setContentText(alarm.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(alarm.body))
            .setContentIntent(tap)
            .setAutoCancel(true)
        val manager = context.getSystemService(NotificationManager::class.java)
        if (alarm.summary) {
            manager.notify(SUMMARY_ID, builder.build())
            return
        }
        builder
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDeleteIntent(action(context, ACTION_DISMISS, alarm, 1))
            .addAction(0, "Done", action(context, ACTION_DONE, alarm, 2))
            .addAction(0, "10 min", action(context, ACTION_SNOOZE, alarm, 3, 10))
            .addAction(0, "1 hour", action(context, ACTION_SNOOZE, alarm, 4, 60))
        manager.notify(notificationId(alarm.task), builder.build())
    }
}
