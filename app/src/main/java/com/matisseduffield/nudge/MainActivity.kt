package com.matisseduffield.nudge

import android.Manifest
import android.annotation.SuppressLint
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
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.matisseduffield.nudge.reminders.Alarms
import com.matisseduffield.nudge.reminders.Store
import com.matisseduffield.nudge.updates.AppUpdates
import com.matisseduffield.nudge.widget.TodayWidget
import org.json.JSONArray
import org.json.JSONObject

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

        // The page's nudgeBack() closes what's open, and says whether it did
        // anything. If not, Back leaves the app.
        const val BACK_JS = "(() => typeof nudgeBack === 'function' && nudgeBack() === true)()"
    }

    private lateinit var web: WebView
    private val updates = AppUpdates(this, ::send)
    private var page: JavaScriptReplyProxy? = null
    private var pageWantsBack = false
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
        // After a rebuild, such as a dark mode switch, the old tap has been dealt with.
        if (savedInstanceState == null) readIntent(intent)
        web.loadUrl(START_URL)

        updates.start(firstCreate = savedInstanceState == null)
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
        updates.onResume()
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
                .put("notifications", notifications && notificationsOn())
                .put("exact", Alarms.canBeExact(this))
                .put("battery", power.isIgnoringBatteryOptimizations(packageName))
                .put("fullScreen", fullScreenOn() && Alarms.urgentChannelOn(this))
                .put("overlay", Settings.canDrawOverlays(this)),
        )
    }

    private fun notificationsOn(): Boolean {
        val manager = getSystemService(android.app.NotificationManager::class.java)
        val channel = manager.getNotificationChannel(Alarms.CHANNEL)
        return manager.areNotificationsEnabled() && channel?.importance != android.app.NotificationManager.IMPORTANCE_NONE
    }

    private fun fullScreenOn() =
        Build.VERSION.SDK_INT < 34 || getSystemService(android.app.NotificationManager::class.java).canUseFullScreenIntent()

    private fun openSettingsFor(what: String) {
        val intent = when (what) {
            "alarms" -> if (Build.VERSION.SDK_INT >= 31) {
                Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, "package:$packageName".toUri())
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:$packageName".toUri())
            }
            "battery" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, "package:$packageName".toUri())
            "fullscreen" -> if (!Alarms.urgentChannelOn(this)) {
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            } else if (Build.VERSION.SDK_INT >= 34) {
                Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, "package:$packageName".toUri())
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:$packageName".toUri())
            }
            else -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        }
        // Not every phone has every settings page.
        runCatching { startActivity(intent) }.onFailure {
            runCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:$packageName".toUri())) }
        }
    }

    private fun onPageMessage(message: WebMessageCompat, reply: JavaScriptReplyProxy) {
        val msg = runCatching { JSONObject(message.data ?: return) }.getOrNull() ?: return
        when (msg.optString("type")) {
            "hello" -> {
                page = reply
                send(JSONObject().put("type", "info").put("version", BuildConfig.VERSION_NAME).put("updates", BuildConfig.SELF_UPDATER).put("askExact", BuildConfig.ASK_EXACT_ALARM))
                send(JSONObject().put("type", "state").put("state", Store.readState(this)).put("actions", Store.takeActions(this)))
                sendHealth()
                sendPendingOpen()
                updates.onPageReady()
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
            "testAlarm" -> Alarms.test(this, msg.optBoolean("loud"))
            "checkUpdate" -> updates.checkNow()
            "installUpdate" -> updates.installPending()
        }
    }

    // Only reachable when WEB_MESSAGE_LISTENER is supported: [page] is set by a bridge message.
    @SuppressLint("RequiresFeature")
    private fun send(json: JSONObject) {
        runCatching { page?.postMessage(json.toString()) }
    }

}
