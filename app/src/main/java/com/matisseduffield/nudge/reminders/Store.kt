package com.matisseduffield.nudge.reminders

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDateTime

/**
 * What lives in the app's files: the page's tasks, the alarms to ring, and what was
 * tapped on notifications while the page wasn't there. All of it travels in Android's
 * backup, so moving to a new phone brings everything across.
 */
object Store {
    private const val STATE = "state.json"
    private const val ALARMS = "alarms.json"
    private const val ACTIONS = "actions.json"
    private val lock = Any()

    /** Set while the page is on screen, so a tap on a notification reaches it straight away. */
    @Volatile var onActions: (() -> Unit)? = null

    // Written beside the real file and swapped in, so a crash can't leave half a file.
    private fun write(context: Context, name: String, text: String) {
        val temp = File(context.filesDir, "$name.tmp")
        temp.writeText(text)
        temp.renameTo(File(context.filesDir, name))
    }

    private fun read(context: Context, name: String): String? {
        val file = File(context.filesDir, name)
        return if (file.exists()) runCatching { file.readText() }.getOrNull() else null
    }

    fun readState(context: Context): String? = synchronized(lock) { read(context, STATE) }

    fun writeState(context: Context, text: String) = synchronized(lock) {
        if (text.isNotEmpty()) write(context, STATE, text)
    }

    fun parse(json: JSONObject): Alarm? = runCatching {
        Alarm(
            id = json.getString("id"),
            task = json.optString("task"),
            occ = json.optString("occ"),
            at = LocalDateTime.parse(json.getString("at")),
            title = json.optString("title"),
            body = json.optString("body"),
            nag = json.optInt("nag"),
            summary = json.optBoolean("summary"),
            loud = json.optBoolean("loud"),
        )
    }.getOrNull()

    private fun toJson(alarm: Alarm) = JSONObject()
        .put("id", alarm.id).put("task", alarm.task).put("occ", alarm.occ).put("at", alarm.at.toString())
        .put("title", alarm.title).put("body", alarm.body).put("nag", alarm.nag).put("summary", alarm.summary).put("loud", alarm.loud)

    fun readAlarms(context: Context): List<Alarm> = synchronized(lock) {
        val text = read(context, ALARMS) ?: return emptyList()
        val array = runCatching { JSONArray(text) }.getOrNull() ?: return emptyList()
        (0 until array.length()).mapNotNull { i -> array.optJSONObject(i)?.let(::parse) }
    }

    fun writeAlarms(context: Context, alarms: List<Alarm>) = synchronized(lock) {
        write(context, ALARMS, JSONArray().apply { alarms.forEach { put(toJson(it)) } }.toString())
    }

    fun addAction(context: Context, action: JSONObject) {
        synchronized(lock) {
            val array = read(context, ACTIONS)?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()
            write(context, ACTIONS, array.put(action).toString())
        }
        onActions?.invoke()
    }

    /** Everything tapped since the page last asked. */
    fun takeActions(context: Context): JSONArray = synchronized(lock) {
        val array = read(context, ACTIONS)?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()
        File(context.filesDir, ACTIONS).delete()
        array
    }
}
