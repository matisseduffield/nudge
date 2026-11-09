package com.matisseduffield.nudge.reminders

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
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
    private var nag = 0
    private var use24: Boolean? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_alarm)
        showing = WeakReference(this)
        // Like a call, it can't be backed out of by accident.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = Unit
        })
        load(intent)
        findViewById<View>(R.id.alarm_done).setOnClickListener { Alarms.done(this, task, occ) }
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
        nag = from.getIntExtra("nag", 0)
        use24 = Alarms.use24Of(from)
        AlarmFace.bind(findViewById(android.R.id.content), title, body, use24)
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
        Alarms.snooze(this, task, occ, title, body, minutes, true, nag, use24)
    }

    // Shown again as the screen wakes: the clock catches up straight away.
    override fun onResume() {
        super.onResume()
        AlarmFace.refresh(findViewById(android.R.id.content))
    }

    override fun onDestroy() {
        timeout.removeCallbacksAndMessages(null)
        AlarmFace.stop(findViewById(android.R.id.content))
        if (showing?.get() === this) showing = null
        super.onDestroy()
    }
}
