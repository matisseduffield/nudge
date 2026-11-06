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
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDate

/** What's due today, and a way to add a task. The page tells it what to show. */
class TodayWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { manager.updateAppWidget(it, views(context)) }
    }

    companion object {
        const val EXTRA_ADD = "add"
        private const val FILE = "widget.json"

        fun save(context: Context, json: JSONObject) {
            File(context.filesDir, FILE).writeText(json.toString())
            refresh(context)
        }

        /** Takes a task ticked off on a notification out of the list. */
        fun taskDone(context: Context, task: String) {
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
            // Yesterday's list says nothing about today, and only the app can work it out.
            val fresh = json?.optString("day") == LocalDate.now().toString()
            val items = if (fresh) json?.optJSONArray("items") else null
            val count = items?.length() ?: 0
            val text = (0 until minOf(count, 6)).joinToString("\n") { items!!.optJSONObject(it)?.optString("title").orEmpty() }
            val views = RemoteViews(context.packageName, R.layout.widget_today)
            val title = when {
                !fresh -> "Open Nudge"
                count == 0 -> "Nothing due today"
                else -> "$count today"
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
