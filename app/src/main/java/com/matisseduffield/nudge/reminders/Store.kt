package com.matisseduffield.nudge.reminders

import android.content.Context
import android.os.UserManager
import android.util.AtomicFile
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
    private const val ALARMS_MOVED = "alarms.moved"   // marks the move to device-protected storage done
    private val lock = Any()

    // Set once alarms.json from before device-protected storage has been dealt with.
    @Volatile private var alarmsMoved = false

    /** Set while the page is on screen, so a tap on a notification reaches it straight away. */
    @Volatile var onActions: (() -> Unit)? = null

    /** False after a restart until the phone is first unlocked: the tasks can't be read till then. */
    fun unlocked(context: Context): Boolean = context.getSystemService(UserManager::class.java).isUserUnlocked

    private fun deviceDir(context: Context): File = context.createDeviceProtectedStorageContext().filesDir

    // Written beside the real file, synced to disk and swapped in, so neither a crash nor
    // the power going can leave half a file.
    private fun write(dir: File, name: String, text: String): Boolean {
        dir.mkdirs()
        val file = AtomicFile(File(dir, name))
        val out = runCatching { file.startWrite() }.getOrNull() ?: return false
        return runCatching {
            out.write(text.toByteArray())
            file.finishWrite(out)
            true
        }.getOrElse {
            file.failWrite(out)
            false
        }
    }

    // Null when there's no file, or it can't be read.
    private fun read(dir: File, name: String): String? = runCatching { String(AtomicFile(File(dir, name)).readFully()) }.getOrNull()

    private fun delete(dir: File, name: String) = AtomicFile(File(dir, name)).delete()

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
    // it's copied to the new place, and the old file only goes once that's written. If the
    // new file is already there it's the one in use, and the old one may hold alarms that
    // have rung since, so it just goes. A marker file means this happens once.
    private fun alarmsDir(context: Context): File {
        val dir = deviceDir(context)
        if (alarmsMoved) return dir
        val marker = File(dir, ALARMS_MOVED)
        if (marker.exists()) {
            alarmsMoved = true
            return dir
        }
        if (!unlocked(context)) return dir
        val old = File(context.filesDir, ALARMS)
        if (old.exists() && !File(dir, ALARMS).exists()) {
            val text = read(context.filesDir, ALARMS) ?: return dir   // try again next time
            if (!write(dir, ALARMS, text)) return dir
        }
        delete(context.filesDir, ALARMS)
        if (runCatching { marker.createNewFile() || marker.exists() }.getOrDefault(false)) alarmsMoved = true
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

    /** Taps made before the phone was unlocked, moved into the usual queue in the order they were made. Returns them. */
    fun moveLockedActions(context: Context): JSONArray = synchronized(lock) {
        if (!unlocked(context)) return JSONArray()
        val dir = deviceDir(context)
        val locked = readArray(dir, ACTIONS)
        if (locked.length() == 0) return JSONArray()
        val queue = readArray(context.filesDir, ACTIONS)
        val all = (0 until queue.length()).map { queue.get(it) } + (0 until locked.length()).map { locked.get(it) }
        val sorted = JSONArray(all.sortedBy { (it as? JSONObject)?.optLong("when") ?: 0L })
        if (!write(context.filesDir, ACTIONS, sorted.toString())) return JSONArray()
        delete(dir, ACTIONS)
        locked
    }

    /** Everything tapped since the page last asked. */
    fun takeActions(context: Context): JSONArray = synchronized(lock) {
        moveLockedActions(context)
        val array = readArray(context.filesDir, ACTIONS)
        delete(context.filesDir, ACTIONS)
        array
    }
}
