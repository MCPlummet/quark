package tel.quark.app

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.app.RemoteInput
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.io.File

class MainActivity : TauriActivity() {
  private companion object {
    /** The default theme's --bg; a light Quark theme still gets dark bars. */
    val BAR_BACKGROUND = Color.parseColor("#0a0a0a")
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // Before Tauri starts: the warm path posts notifications through this
    // (notify.rs → push_jni.rs → PushNotifier), not through the plugin bridge.
    PushNative.install(this)
    // Light bar icons in every system theme: the strips behind the bars are the
    // app's dark background (applyWindowInsets), and the default auto style
    // picks dark icons whenever the system is in light mode — invisible there.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
    applyWindowInsets()
    capturePendingNotificationAction(intent)
  }

  /**
   * Keep the webview between the system bars and above the soft keyboard.
   *
   * In edge-to-edge mode (enableEdgeToEdge above; enforced anyway on Android
   * 15+ at targetSdk 35+) the window extends under the status and navigation
   * bars, and the framework never resizes it for the IME, so the manifest's
   * adjustResize is inert. The web layer can't make up for either: the system
   * WebView reports no system-bar insets through env(safe-area-inset-*) (the
   * Chromium 124 WebView on the API 35 AOSP image reports 0), and wry's WebView
   * doesn't report the keyboard through visualViewport (#33,
   * tauri-apps/tauri#10631). So the page drew under the navigation bar, which
   * took the taps on anything at the bottom edge — the image viewer's buttons
   * among them.
   *
   * Apply all three as padding on the content view instead: the webview
   * genuinely shrinks to the space between the bars (bottom: the keyboard
   * when it is open, which already includes the navigation bar's height),
   * the page sees a resize, and the frontend's --keyboard-offset tracker
   * computes 0. This is the layout iOS gives WKWebView, so the stylesheet's
   * env(safe-area-inset-*) rules stay at 0 on both.
   */
  private fun applyWindowInsets() {
    val content = findViewById<View>(android.R.id.content)
    // What shows through the bars: the default theme's --bg (theme/vars.css).
    content.setBackgroundColor(BAR_BACKGROUND)
    val bars = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val reserved = insets.getInsets(bars)
      val imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      view.setPadding(reserved.left, reserved.top, reserved.right, maxOf(reserved.bottom, imeBottom))
      // Strip what was applied before it reaches the webview, so no Chromium
      // version that does map these to safe-area insets applies them twice.
      WindowInsetsCompat.Builder(insets)
        .setInsets(bars, Insets.NONE)
        .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
        .build()
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    capturePendingNotificationAction(intent)
  }

  /**
   * The notification plugin delivers taps/actions as Activity intents and
   * fires its `actionPerformed` event from them — but events that arrive
   * before the frontend registers a listener (cold start, or the webview
   * relaunching while the foreground sync service kept the process alive)
   * are silently dropped. Mirror the intent's extras to a file the Rust
   * `take_pending_notification_action` command reads-and-deletes at boot.
   *
   * Extra keys match tauri-plugin-notification's TauriNotificationManager:
   * "NotificationId", "NotificationUserAction", "LocalNotficationObject"
   * (sic), "NotificationRemoteInput".
   */
  private fun capturePendingNotificationAction(intent: Intent?) {
    if (intent == null || Intent.ACTION_MAIN != intent.action) return
    val notificationId = intent.getIntExtra("NotificationId", Int.MIN_VALUE)
    if (notificationId == Int.MIN_VALUE) return

    try {
      val json = JSONObject()
      json.put("ts", System.currentTimeMillis())
      json.put("actionId", intent.getStringExtra("NotificationUserAction") ?: "tap")
      val input = RemoteInput.getResultsFromIntent(intent)
        ?.getCharSequence("NotificationRemoteInput")
        ?.toString()
      json.put("inputValue", input ?: JSONObject.NULL)
      val notificationJson = intent.getStringExtra("LocalNotficationObject")
      json.put(
        "notification",
        if (notificationJson != null) JSONObject(notificationJson) else JSONObject.NULL
      )
      // dataDir matches Tauri's app_data_dir() on Android.
      File(dataDir, "pending_notification.json").writeText(json.toString())
    } catch (_: Exception) {
      // Non-critical: a lost cold-start tap degrades to opening the app.
    }
  }
}
