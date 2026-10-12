package tel.quark.app

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Log
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import kotlin.concurrent.thread

/**
 * App-local Tauri plugin that saves a downloaded image or video where the user
 * can find it again (#124, #125): the gallery, or a location they pick.
 *
 * Registered from Rust via `register_android_plugin` (media_save.rs) and
 * reached only through `run_mobile_plugin_async`, so there is no JS surface and
 * no capability wiring. Rust stages the file and passes its path; it removes
 * the staged copy once the command resolves, so every copy here finishes
 * before resolving.
 */
@TauriPlugin
class MediaSavePlugin(private val activity: Activity) : Plugin(activity) {
  private companion object {
    const val TAG = "quark"
    const val ALBUM = "Quark"
  }

  /** The staged file a create-document picker is open for. */
  private var pendingSource: File? = null

  private fun args(invoke: Invoke): Triple<File, String, String>? {
    val args = invoke.getArgs()
    val path = args.optString("path")
    if (path.isEmpty()) {
      invoke.reject("No file to save")
      return null
    }
    val mime = args.optString("mimeType").ifEmpty { "application/octet-stream" }
    val name = args.optString("displayName").ifEmpty { File(path).name }
    return Triple(File(path), mime, name)
  }

  /**
   * Add the file to the shared gallery under Pictures/Quark (or Movies/Quark).
   *
   * Through MediaStore with a relative path, which needs no storage permission
   * from Android 10 on. Older releases would need WRITE_EXTERNAL_STORAGE and a
   * runtime prompt for this one feature; there the user is pointed at "save as
   * file", which works everywhere.
   */
  @Command
  fun saveToGallery(invoke: Invoke) {
    val (source, mime, name) = args(invoke) ?: return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      invoke.reject("Saving to the gallery needs Android 10 or newer — use save as file instead")
      return
    }
    val (collection, directory) = when {
      mime.startsWith("image/") ->
        MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to
          Environment.DIRECTORY_PICTURES
      mime.startsWith("video/") ->
        MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) to
          Environment.DIRECTORY_MOVIES
      else -> {
        invoke.reject("Only images and videos can be saved to the gallery")
        return
      }
    }

    // Off the main thread: the copy is disk I/O of arbitrary size.
    thread(name = "quark-save") {
      val resolver = activity.contentResolver
      var uri: Uri? = null
      try {
        val values = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, name)
          put(MediaStore.MediaColumns.MIME_TYPE, mime)
          put(MediaStore.MediaColumns.RELATIVE_PATH, "$directory/$ALBUM")
          // Hidden from other apps until the bytes are all there.
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        uri = resolver.insert(collection, values) ?: throw IllegalStateException("MediaStore refused the file")
        copyInto(source, uri)
        resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        invoke.resolve(JSObject().apply {
          put("saved", true)
          put("location", "$directory/$ALBUM")
        })
      } catch (e: Throwable) {
        Log.e(TAG, "Saving to the gallery failed", e)
        uri?.let { runCatching { resolver.delete(it, null, null) } }
        invoke.reject("Couldn't save to the gallery: ${e.message ?: e.javaClass.simpleName}")
      }
    }
  }

  /**
   * Let the user pick where the file goes with the system create-document
   * picker (Storage Access Framework), then copy it there. Works on every
   * supported release and needs no permission — the picker grants access to
   * exactly the document the user created.
   */
  @Command
  fun saveToFile(invoke: Invoke) {
    val (source, mime, name) = args(invoke) ?: return
    if (pendingSource != null) {
      invoke.reject("A save is already in progress")
      return
    }
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = mime
      putExtra(Intent.EXTRA_TITLE, name)
    }
    pendingSource = source
    try {
      startActivityForResult(invoke, intent, "onDocumentCreated")
    } catch (e: Throwable) {
      pendingSource = null
      Log.e(TAG, "Could not open the file picker", e)
      invoke.reject("Couldn't open the file picker")
    }
  }

  @ActivityCallback
  fun onDocumentCreated(invoke: Invoke, result: ActivityResult) {
    val source = pendingSource
    pendingSource = null
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null || source == null) {
      invoke.resolve(JSObject().apply { put("saved", false) })
      return
    }
    thread(name = "quark-save") {
      try {
        copyInto(source, uri)
        invoke.resolve(JSObject().apply {
          put("saved", true)
          put("location", displayName(uri) ?: source.name)
        })
      } catch (e: Throwable) {
        Log.e(TAG, "Saving the file failed", e)
        // The picker already created an empty document; don't leave it behind.
        runCatching { android.provider.DocumentsContract.deleteDocument(activity.contentResolver, uri) }
        invoke.reject("Couldn't save the file: ${e.message ?: e.javaClass.simpleName}")
      }
    }
  }

  private fun copyInto(source: File, uri: Uri) {
    val output = activity.contentResolver.openOutputStream(uri, "w")
      ?: throw IllegalStateException("Couldn't open the destination")
    output.use { out -> source.inputStream().use { it.copyTo(out) } }
  }

  /** The name the user gave the document, which may differ from ours. */
  private fun displayName(uri: Uri): String? =
    runCatching {
      activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
      }
    }.getOrNull()
}
