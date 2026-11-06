package com.matisseduffield.nudge

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.matisseduffield.nudge.reminders.Alarms
import com.matisseduffield.nudge.reminders.Store
import com.matisseduffield.nudge.updates.UpdateManager
import com.matisseduffield.nudge.widget.TodayWidget
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Hosts web/index.html (bundled as assets) in a WebView. The page owns the tasks
 * and works out when reminders fire; [Alarms] rings them, so they still ring with
 * the app closed. The asset loader serves them from a real
 * https origin, so localStorage behaves exactly as it does in a browser. A
 * message bridge, limited to that origin, lets a page drive Back, sharing,
 * haptics and update checks.
 */
class MainActivity : ComponentActivity() {
    private companion object {
        const val APP_HOST = WebViewAssetLoader.DEFAULT_DOMAIN
        const val APP_ORIGIN = "https://$APP_HOST"
        const val START_URL = "$APP_ORIGIN/assets/index.html"
        const val BRIDGE_NAME = "nudgeApp"
        const val CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L

        // The page's nudgeBack() closes what's open, and says whether it did
        // anything. If not, Back leaves the app.
        const val BACK_JS = "(() => typeof nudgeBack === 'function' && nudgeBack() === true)()"
    }

    private lateinit var web: WebView
    private var lastUpdateCheck = 0L
    private var updatePromptOpen = false
    private var page: JavaScriptReplyProxy? = null
    private var pageWantsBack = false
    private val bridgeSupported by lazy { WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) }
    private var pendingUpdate: UpdateManager.UpdateInfo? = null
    private var installing = false
    private var pendingOpen: String? = null
    private var pendingAdd = false
    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { sendHealth() }

    // With the bridge, Back is only intercepted while there's somewhere to go
    // back to (a game's "back" message, or the hub behind a game), so the
    // system's predictive back gesture works on the hub.
    private val pageBack = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            web.evaluateJavascript(BACK_JS) { handled ->
                if (handled != "true" && web.canGoBack()) web.goBack()
            }
        }
    }

    private fun updateBack() {
        pageBack.isEnabled = pageWantsBack || web.canGoBack()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !night
            isAppearanceLightNavigationBars = !night
        }

        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            setBackgroundColor(getColor(R.color.page_bg))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            // Follow the phone's font size setting.
            settings.textZoom = (resources.configuration.fontScale * 100).toInt()
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? = assets.shouldInterceptRequest(request.url)

                override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                    pageWantsBack = false
                }

                // The hub is the bottom of the stack, however it was reached,
                // so Back there leaves the app.
                override fun onPageFinished(view: WebView, url: String) {
                    if (url == START_URL) view.clearHistory()
                    updateBack()
                }

                override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                    updateBack()
                }

                // If Android ends the page's renderer (low memory), start the
                // screen again rather than letting the whole app crash.
                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    recreate()
                    return true
                }

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == APP_HOST) return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    return true
                }
            }
        }

        val root = FrameLayout(this).apply {
            setBackgroundColor(getColor(R.color.page_bg))
            addView(web)
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, BRIDGE_NAME, setOf(APP_ORIGIN)) { _, message, origin, isMainFrame, reply ->
                if (isMainFrame && origin == APP_ORIGIN.toUri()) onPageMessage(message, reply)
            }
            onBackPressedDispatcher.addCallback(this, pageBack)
        } else {
            // Older WebView without the bridge: always ask the page first.
            onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    web.evaluateJavascript(BACK_JS) { handled ->
                        if (handled == "true") return@evaluateJavascript
                        if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
                    }
                }
            })
        }
        readIntent(intent)
        web.loadUrl(START_URL)

        // A downloaded update has done its job once the new version is running.
        if (savedInstanceState == null) {
            lifecycleScope.launch(Dispatchers.IO) { File(cacheDir, "updates").deleteRecursively() }
        }

        lifecycleScope.launch {
            UpdateManager.installError.collect { message ->
                if (message != null) {
                    if (installing) {
                        installing = false
                        sendUpdateState("failed") { put("message", message) }
                    } else {
                        Toast.makeText(this@MainActivity, message, Toast.LENGTH_LONG).show()
                    }
                    UpdateManager.installError.value = null
                }
            }
        }
    }

    // Out of sight, the page's timers stop entirely; they resume (and catch
    // up with a new day) as soon as the app is back.
    override fun onResume() {
        super.onResume()
        web.onResume()
        web.resumeTimers()
        Store.onActions = { runOnUiThread { sendActions() } }
        sendActions()
        sendHealth()
        sendPendingOpen()
        maybeCheckForUpdate()
    }

    override fun onPause() {
        Store.onActions = null
        web.onPause()
        web.pauseTimers()
        super.onPause()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        readIntent(intent)
        sendPendingOpen()
    }

    private fun readIntent(intent: Intent?) {
        pendingOpen = intent?.getStringExtra(Alarms.EXTRA_TASK)?.takeIf { it.isNotEmpty() } ?: pendingOpen
        if (intent?.getBooleanExtra(TodayWidget.EXTRA_ADD, false) == true) pendingAdd = true
    }

    private fun sendPendingOpen() {
        if (page == null) return
        pendingOpen?.let { send(JSONObject().put("type", "open").put("task", it)) }
        pendingOpen = null
        if (pendingAdd) send(JSONObject().put("type", "focusAdd"))
        pendingAdd = false
    }

    private fun sendActions() {
        if (page == null) return
        val actions = Store.takeActions(this)
        if (actions.length() > 0) send(JSONObject().put("type", "actions").put("actions", actions))
    }

    private fun sendHealth() {
        if (page == null) return
        val notifications = Build.VERSION.SDK_INT < 33 ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val power = getSystemService(PowerManager::class.java)
        send(
            JSONObject()
                .put("type", "health")
                .put("notifications", notifications && getSystemService(android.app.NotificationManager::class.java).areNotificationsEnabled())
                .put("exact", Alarms.canBeExact(this))
                .put("battery", power.isIgnoringBatteryOptimizations(packageName)),
        )
    }

    private fun openSettingsFor(what: String) {
        val intent = when (what) {
            "alarms" -> if (Build.VERSION.SDK_INT >= 31) {
                Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, "package:$packageName".toUri())
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:$packageName".toUri())
            }
            "battery" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            else -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        }
        runCatching { startActivity(intent) }
    }

    private fun onPageMessage(message: WebMessageCompat, reply: JavaScriptReplyProxy) {
        val msg = runCatching { JSONObject(message.data ?: return) }.getOrNull() ?: return
        when (msg.optString("type")) {
            "hello" -> {
                page = reply
                send(JSONObject().put("type", "info").put("version", BuildConfig.VERSION_NAME))
                send(JSONObject().put("type", "state").put("state", Store.readState(this)).put("actions", Store.takeActions(this)))
                sendHealth()
                sendPendingOpen()
                pendingUpdate?.let { sendUpdateCard(it) }
            }
            "back" -> {
                pageWantsBack = msg.optBoolean("enabled")
                updateBack()
            }
            "share" -> runCatching {
                val send = Intent(Intent.ACTION_SEND)
                    .setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, msg.optString("title"))
                    .putExtra(Intent.EXTRA_TEXT, msg.optString("text"))
                startActivity(Intent.createChooser(send, null))
            }
            // System tap feedback; Android skips it if touch feedback is off.
            "haptic" -> web.performHapticFeedback(
                if (msg.optString("kind") == "tick") HapticFeedbackConstants.CLOCK_TICK
                else HapticFeedbackConstants.VIRTUAL_KEY,
            )
            "save" -> {
                Store.writeState(this, msg.optString("state"))
                Alarms.replace(this, msg.optJSONArray("alarms") ?: JSONArray())
                msg.optJSONObject("widget")?.let { TodayWidget.save(this, it) }
            }
            "askNotifications" -> if (Build.VERSION.SDK_INT >= 33) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
            "openSettings" -> openSettingsFor(msg.optString("what"))
            "checkUpdate" -> checkForUpdateNow()
            "installUpdate" -> pendingUpdate?.let { installFromCard(it) }
        }
    }

    // ---- update card ----
    // With the bridge, updates appear as a card in the page; the system dialog
    // below is only the fallback for WebViews without it.

    private fun onUpdateAvailable(info: UpdateManager.UpdateInfo) {
        if (!bridgeSupported) {
            if (!updatePromptOpen) offerUpdate(info)
            return
        }
        pendingUpdate = info
        sendUpdateCard(info) // no-op until the page has said hello; "hello" sends it then
    }

    private fun sendUpdateCard(info: UpdateManager.UpdateInfo) {
        if (installing) return
        send(
            JSONObject()
                .put("type", "update")
                .put("state", "available")
                .put("version", info.versionName)
                .put("size", info.sizeBytes)
                .put("notes", JSONArray(info.notes)),
        )
    }

    private fun sendUpdateState(state: String, extra: JSONObject.() -> Unit = {}) {
        runOnUiThread { send(JSONObject().put("type", "update").put("state", state).apply(extra)) }
    }

    private fun installFromCard(info: UpdateManager.UpdateInfo) {
        if (installing) return
        installing = true
        lifecycleScope.launch {
            try {
                var lastPct = -1
                val apk = UpdateManager.download(this@MainActivity, info) { fraction ->
                    val pct = (fraction * 100).toInt()
                    if (pct != lastPct) {
                        lastPct = pct
                        sendUpdateState("downloading") { put("progress", fraction.toDouble()) }
                    }
                }
                sendUpdateState("installing")
                UpdateManager.install(this@MainActivity, apk)
            } catch (e: Exception) {
                installing = false
                sendUpdateState("failed") { put("message", e.message ?: "The download didn't finish.") }
            }
        }
    }

    // Only reachable when WEB_MESSAGE_LISTENER is supported: [page] is set by a bridge message.
    @SuppressLint("RequiresFeature")
    private fun send(json: JSONObject) {
        runCatching { page?.postMessage(json.toString()) }
    }

    /** Result of a check the page asked for: "available", "latest" or "failed". */
    private fun sendUpdateStatus(state: String) {
        send(JSONObject().put("type", "updateStatus").put("state", state))
    }

    private fun checkForUpdateNow() {
        lastUpdateCheck = System.currentTimeMillis()
        lifecycleScope.launch {
            when (val result = UpdateManager.check()) {
                is UpdateManager.CheckResult.Available -> {
                    sendUpdateStatus("available")
                    onUpdateAvailable(result.info)
                }
                UpdateManager.CheckResult.UpToDate -> sendUpdateStatus("latest")
                is UpdateManager.CheckResult.Failed -> sendUpdateStatus("failed")
            }
        }
    }

    private fun maybeCheckForUpdate() {
        val now = System.currentTimeMillis()
        if (updatePromptOpen || now - lastUpdateCheck < CHECK_INTERVAL_MS) return
        lastUpdateCheck = now
        lifecycleScope.launch {
            val result = UpdateManager.check()
            if (result is UpdateManager.CheckResult.Available && !isFinishing) onUpdateAvailable(result.info)
        }
    }

    private fun offerUpdate(info: UpdateManager.UpdateInfo) {
        updatePromptOpen = true
        AlertDialog.Builder(this)
            .setTitle("Update available")
            .setMessage("Nudge ${info.versionName} is ready to install. You have ${BuildConfig.VERSION_NAME}.")
            .setPositiveButton("Update") { _, _ -> runUpdate(info) }
            .setNegativeButton("Later", null)
            .setOnDismissListener { updatePromptOpen = false }
            .show()
    }

    private fun runUpdate(info: UpdateManager.UpdateInfo) {
        val pad = (24 * resources.displayMetrics.density).toInt()
        val bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            isIndeterminate = info.sizeBytes <= 0
        }
        val box = FrameLayout(this).apply {
            setPadding(pad, pad / 2, pad, 0)
            addView(bar)
        }
        val progress = AlertDialog.Builder(this)
            .setTitle("Downloading ${info.versionName}")
            .setView(box)
            .setCancelable(false)
            .show()

        lifecycleScope.launch {
            try {
                val apk = UpdateManager.download(this@MainActivity, info) { fraction ->
                    runOnUiThread { bar.progress = (fraction * 100).toInt() }
                }
                progress.dismiss()
                UpdateManager.install(this@MainActivity, apk)
            } catch (e: Exception) {
                progress.dismiss()
                Toast.makeText(
                    this@MainActivity,
                    "Update failed: ${e.message ?: "unknown error"}",
                    Toast.LENGTH_LONG,
                ).show()
            }
        }
    }
}
