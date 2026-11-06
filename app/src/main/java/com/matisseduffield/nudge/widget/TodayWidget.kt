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
import org.json.JSONObject
import java.io.File

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
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TodayWidget::class.java))
            ids.forEach { manager.updateAppWidget(it, views(context)) }
        }

        private fun views(context: Context): RemoteViews {
            val file = File(context.filesDir, FILE)
            val json = if (file.exists()) runCatching { JSONObject(file.readText()) }.getOrNull() else null
            val count = json?.optInt("count") ?: 0
            val lines = json?.optJSONArray("lines")
            val text = (0 until (lines?.length() ?: 0)).joinToString("\n") { lines!!.optString(it) }
            val views = RemoteViews(context.packageName, R.layout.widget_today)
            views.setTextViewText(R.id.widget_title, if (count == 0) "Nothing due today" else "$count today")
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
