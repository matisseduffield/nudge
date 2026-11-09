package com.matisseduffield.nudge.reminders

import android.content.Context
import android.os.UserManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDateTime

/**
 * What lives in the app's files: the page's tasks, the alarms to ring, and what was
 * tapped on notifications while the page wasn't there. All of it travels in Android's
 * backup, so moving to a new phone brings everything across.
 *
 * The alarms are kept in device-protected storage, which can be read after a restart
 * before the phone is first unlocked, so reminders ring then too. The tasks stay in
 * the usual storage, which Android keeps locked until then.
 */
object Store {
    private const val STATE = "state.json"
    private const val ALARMS = "alarms.json"
    private const val ACTIONS = "actions.json"
    private val lock = Any()

    // Set once alarms.json from before device-protected storage has been moved across.
    @Volatile private var alarmsMoved = false

    /** Set while the page is on screen, so a tap on a notification reaches it straight away. */
    @Volatile var onActions: (() -> Unit)? = null

    /** False after a restart until the phone is first unlocked: the tasks can't be read till then. */
    fun unlocked(context: Context): Boolean = context.getSystemService(UserManager::class.java).isUserUnlocked

    private fun deviceDir(context: Context): File = context.createDeviceProtectedStorageContext().filesDir

    // Written beside the real file and swapped in, so a crash can't leave half a file.
    private fun write(dir: File, name: String, text: String): Boolean = runCatching {
        dir.mkdirs()
        val temp = File(dir, "$name.tmp")
        temp.writeText(text)
        temp.renameTo(File(dir, name))
    }.getOrDefault(false)

    private fun read(dir: File, name: String): String? {
        val file = File(dir, name)
        return if (file.exists()) runCatching { file.readText() }.getOrNull() else null
    }

    private fun readArray(dir: File, name: String) = read(dir, name)?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()

    fun readState(context: Context): String? = synchronized(lock) {
        if (unlocked(context)) read(context.filesDir, STATE) else null
    }

    fun writeState(context: Context, text: String) = synchronized(lock) {
        if (text.isNotEmpty()) write(context.filesDir, STATE, text)
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

    private fun parseAll(text: String?): List<Alarm> {
        val array = text?.let { runCatching { JSONArray(it) }.getOrNull() } ?: return emptyList()
        return (0 until array.length()).mapNotNull { i -> array.optJSONObject(i)?.let(::parse) }
    }

    private fun alarmsText(alarms: List<Alarm>) = JSONArray().apply { alarms.forEach { put(toJson(it)) } }.toString()

    // Versions before 1.3 kept alarms.json in the usual storage. Once the phone is unlocked
    // it's merged into the new place, and the old file only goes once that's written.
    private fun alarmsDir(context: Context): File {
        val dir = deviceDir(context)
        if (alarmsMoved || !unlocked(context)) return dir
        val old = File(context.filesDir, ALARMS)
        if (old.exists()) {
            val text = runCatching { old.readText() }.getOrNull() ?: return dir
            val merged = (parseAll(read(dir, ALARMS)) + parseAll(text)).distinctBy { it.id }
            if (!write(dir, ALARMS, alarmsText(merged))) return dir
            old.delete()
        }
        alarmsMoved = true
        return dir
    }

    fun readAlarms(context: Context): List<Alarm> = synchronized(lock) {
        parseAll(read(alarmsDir(context), ALARMS))
    }

    fun writeAlarms(context: Context, alarms: List<Alarm>) = synchronized(lock) {
        write(alarmsDir(context), ALARMS, alarmsText(alarms))
    }

    fun addAction(context: Context, action: JSONObject) {
        synchronized(lock) {
            // Before the first unlock only device-protected storage can be written.
            // moveLockedActions brings those across afterwards.
            val dir = if (unlocked(context)) context.filesDir else deviceDir(context)
            write(dir, ACTIONS, readArray(dir, ACTIONS).put(action).toString())
        }
        onActions?.invoke()
    }

    /** Taps made before the phone was unlocked, moved to the end of the usual queue. Returns them. */
    fun moveLockedActions(context: Context): JSONArray = synchronized(lock) {
        if (!unlocked(context)) return JSONArray()
        val dir = deviceDir(context)
        val locked = readArray(dir, ACTIONS)
        if (locked.length() == 0) return JSONArray()
        val queue = readArray(context.filesDir, ACTIONS)
        for (i in 0 until locked.length()) queue.put(locked.get(i))
        if (!write(context.filesDir, ACTIONS, queue.toString())) return JSONArray()
        File(dir, ACTIONS).delete()
        locked
    }

    /** Everything tapped since the page last asked. */
    fun takeActions(context: Context): JSONArray = synchronized(lock) {
        moveLockedActions(context)
        val array = readArray(context.filesDir, ACTIONS)
        File(context.filesDir, ACTIONS).delete()
        array
    }
}
