package com.matisseduffield.nudge.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.matisseduffield.nudge.MainActivity
import com.matisseduffield.nudge.R
import com.matisseduffield.nudge.reminders.Store
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDate

/**
 * What's due today, and a way to add a task. The page sends a week of dated tasks, so
 * at midnight (on the next half-hourly refresh) it moves on to the new day by itself.
 */
class TodayWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { manager.updateAppWidget(it, views(context)) }
    }

    companion object {
        const val EXTRA_ADD = "add"
        private const val FILE = "widget.json"
        private const val WEEK = 7L   // as far ahead as the page sends

        fun save(context: Context, json: JSONObject) {
            val text = json.toString()
            val file = File(context.filesDir, FILE)
            if (file.exists() && runCatching { file.readText() }.getOrNull() == text) return
            file.writeText(text)
            refresh(context)
        }

        /** Takes a task ticked off on a notification out of the list. */
        fun taskDone(context: Context, task: String) {
            // Before the first unlock its file can't be read. SystemReceiver catches up after.
            if (!Store.unlocked(context)) return
            val json = read(context) ?: return
            val items = json.optJSONArray("items") ?: return
            val left = JSONArray()
            for (i in 0 until items.length()) {
                val item = items.optJSONObject(i) ?: continue
                if (item.optString("id") != task) left.put(item)
            }
            save(context, json.put("items", left))
        }

        private fun read(context: Context): JSONObject? {
            val file = File(context.filesDir, FILE)
            return if (file.exists()) runCatching { JSONObject(file.readText()) }.getOrNull() else null
        }

        private fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TodayWidget::class.java))
            ids.forEach { manager.updateAppWidget(it, views(context)) }
        }

        private fun views(context: Context): RemoteViews {
            val json = read(context)
            val today = LocalDate.now()
            val sent = runCatching { LocalDate.parse(json?.optString("day")) }.getOrNull()
            // Past the week the page sent, only the app can work out what's due.
            val fresh = sent != null && !today.isAfter(sent.plusDays(WEEK))
            val all = json?.optJSONArray("items") ?: JSONArray()
            // Older versions sent no dates, only what was due on the day they sent.
            val items = (0 until all.length()).mapNotNull { all.optJSONObject(it) }
                .map { it.optString("title") to (runCatching { LocalDate.parse(it.optString("due")) }.getOrNull() ?: sent ?: today) }
                .filter { (_, due) -> !due.isAfter(today) }
            val late = items.count { (_, due) -> due.isBefore(today) }
            val due = items.size - late
            val text = if (fresh) items.take(6).joinToString("\n") { it.first } else ""
            val views = RemoteViews(context.packageName, R.layout.widget_today)
            val title = when {
                !fresh -> "Open Nudge"
                items.isEmpty() -> "Nothing due today"
                late == 0 -> "$due today"
                due == 0 -> "$late overdue"
                else -> "$due today, $late overdue"
            }
            views.setTextViewText(R.id.widget_title, title)
            views.setTextViewText(R.id.widget_lines, text)
            val open = Intent(context, MainActivity::class.java).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            views.setOnClickPendingIntent(
                R.id.widget_root,
                PendingIntent.getActivity(context, 10, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
            )
            val add = Intent(context, MainActivity::class.java).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(EXTRA_ADD, true)
            views.setOnClickPendingIntent(
                R.id.widget_add,
                PendingIntent.getActivity(context, 11, add, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
            )
            return views
        }
    }
}
