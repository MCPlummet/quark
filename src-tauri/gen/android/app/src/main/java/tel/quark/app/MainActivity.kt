package tel.quark.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.app.RemoteInput
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    applyImeInsets()
    capturePendingNotificationAction(intent)
  }

  /**
   * Resize the webview when the soft keyboard opens (#33).
   *
   * In edge-to-edge mode (enableEdgeToEdge above; enforced anyway on Android
   * 15+ at targetSdk 35+) the framework never resizes the window for the IME,
   * so the manifest's adjustResize is inert — and the web layer cannot
   * compensate because wry's WebView doesn't report the keyboard through
   * visualViewport (tauri-apps/tauri#10631). Consume the IME inset here and
   * apply it as bottom padding on the content view: the webview genuinely
   * shrinks, the page sees the resize, and the frontend's --keyboard-offset
   * tracker correctly computes 0.
   */
  private fun applyImeInsets() {
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      view.setPadding(view.paddingLeft, view.paddingTop, view.paddingRight, imeBottom)
      // Strip the IME inset before it reaches the webview so no Chromium
      // version double-applies it; system-bar insets pass through untouched.
      WindowInsetsCompat.Builder(insets)
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
