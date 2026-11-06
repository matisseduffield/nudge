package com.matisseduffield.nudge.reminders

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import com.matisseduffield.nudge.R
import java.lang.ref.WeakReference

/**
 * An urgent task, full screen, over the lock screen. The sound comes from the
 * notification behind it, so this page only shows the task and takes the answer.
 */
class AlarmActivity : ComponentActivity() {
    companion object {
        const val RING_MS = 120_000L
        private var showing: WeakReference<AlarmActivity>? = null

        /** The task's been dealt with somewhere else, so its page goes too. */
        fun close(task: String) {
            val page = showing?.get() ?: return
            page.runOnUiThread { page.closed(task) }
        }
    }

    private val timeout = Handler(Looper.getMainLooper())
    private val waiting = ArrayDeque<Intent>()   // other urgent tasks that rang while this one was up
    private var task = ""
    private var occ = ""
    private var title = ""
    private var body = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_alarm)
        showing = WeakReference(this)
        // Like a call, it can't be backed out of by accident.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = Unit
        })
        load(intent)
        findViewById<View>(R.id.alarm_done).setOnClickListener {
            val answered = task
            if (answered.isEmpty()) Alarms.stop(this, answered) else Alarms.done(this, answered, occ)
        }
        findViewById<View>(R.id.alarm_ten).setOnClickListener { snooze(10) }
        findViewById<View>(R.id.alarm_hour).setOnClickListener { snooze(60) }
        findViewById<View>(R.id.alarm_stop).setOnClickListener { Alarms.stop(this, task) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val other = intent.getStringExtra(Alarms.EXTRA_TASK).orEmpty()
        if (other == task) load(intent) else waiting.addLast(intent)
    }

    private fun load(from: Intent) {
        task = from.getStringExtra(Alarms.EXTRA_TASK).orEmpty()
        occ = from.getStringExtra("occ").orEmpty()
        title = from.getStringExtra("title").orEmpty()
        body = from.getStringExtra("body").orEmpty()
        findViewById<TextView>(R.id.alarm_title).text = title
        findViewById<TextView>(R.id.alarm_body).text = body
        // Left alone, the page goes when the ringing does, and nudging brings it back.
        val left = from.getLongExtra("until", 0) - System.currentTimeMillis()
        timeout.removeCallbacksAndMessages(null)
        timeout.postDelayed({ next() }, left.coerceIn(1000, RING_MS))
    }

    private fun closed(answered: String) {
        waiting.removeAll { it.getStringExtra(Alarms.EXTRA_TASK).orEmpty() == answered }
        if (answered == task) next()
    }

    // On to the next one still ringing, or away.
    private fun next() {
        while (waiting.isNotEmpty()) {
            val up = waiting.removeFirst()
            if (Alarms.ringing(this, up.getStringExtra(Alarms.EXTRA_TASK).orEmpty())) return load(up)
        }
        finish()
    }

    private fun snooze(minutes: Long) {
        if (task.isEmpty()) Alarms.stop(this, task) else Alarms.snooze(this, task, occ, title, body, minutes, true)
    }

    override fun onDestroy() {
        timeout.removeCallbacksAndMessages(null)
        if (showing?.get() === this) showing = null
        super.onDestroy()
    }
}
