package io.muse.remote.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.compose.ui.graphics.asImageBitmap
import io.muse.remote.core.ComposerAttachment
import io.muse.remote.ui.PickedAttachment
import java.io.ByteArrayOutputStream

/** Called on Dispatchers.IO. Never retains URI permissions or raw images. */
internal object AndroidAttachmentReader {
    private const val MAX_FILE_BYTES = 10 * 1024 * 1024
    private const val MAX_IMAGE_B64_CHARS = 4 * 1024 * 1024
    private const val MAX_IMAGE_SIDE = 1568

    private fun displayName(context: Context, uri: Uri, fallback: String): String {
        val cursor = context.contentResolver.query(uri,
            arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        val name = cursor?.use {
            if (it.moveToFirst()) it.getString(0) else null
        }.orEmpty()
        return name.takeIf { it.isNotBlank() }?.take(120) ?: fallback
    }

    fun readPhoto(context: Context, uri: Uri): PickedAttachment {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        require(bounds.outWidth in 1..150_000 && bounds.outHeight in 1..150_000) {
            "No se pudo leer esta imagen."
        }
        var sample = 1
        while (bounds.outWidth / sample > MAX_IMAGE_SIDE * 2 ||
            bounds.outHeight / sample > MAX_IMAGE_SIDE * 2) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val bitmap = resolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, options)
        } ?: error("No se pudo decodificar la foto.")
        val scale = minOf(1f,
            MAX_IMAGE_SIDE.toFloat() / maxOf(bitmap.width, bitmap.height).toFloat())
        val width = maxOf(1, (bitmap.width * scale).toInt())
        val height = maxOf(1, (bitmap.height * scale).toInt())
        val flattened = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(flattened)
        canvas.drawColor(Color.WHITE)
        canvas.drawBitmap(bitmap, null,
            android.graphics.Rect(0, 0, width, height),
            Paint(Paint.FILTER_BITMAP_FLAG))
        if (bitmap !== flattened) bitmap.recycle()
        val output = ByteArrayOutputStream()
        var quality = 85
        var bytes: ByteArray
        do {
            output.reset()
            check(flattened.compress(Bitmap.CompressFormat.JPEG, quality, output)) {
                "No se pudo comprimir la foto."
            }
            bytes = output.toByteArray()
            quality -= 10
        } while (((bytes.size + 2L) / 3L) * 4L > MAX_IMAGE_B64_CHARS && quality >= 35)
        require(((bytes.size + 2L) / 3L) * 4L <= MAX_IMAGE_B64_CHARS) {
            "La imagen supera el límite de 3 MiB."
        }
        val thumbnail = Bitmap.createScaledBitmap(flattened,
            maxOf(1, width * 320 / maxOf(width, height)),
            maxOf(1, height * 320 / maxOf(width, height)), true)
        flattened.recycle()
        val photo = ComposerAttachment.Photo(
            name = displayName(context, uri, "imagen.jpg"),
            base64Data = Base64.encodeToString(bytes, Base64.NO_WRAP),
            width = width,
            height = height,
        )
        return PickedAttachment(photo, thumbnail.asImageBitmap())
    }

    fun readDocument(context: Context, uri: Uri): PickedAttachment {
        val content = context.contentResolver.openInputStream(uri)?.use { input ->
            val output = ByteArrayOutputStream()
            val chunk = ByteArray(8192)
            while (true) {
                val n = input.read(chunk)
                if (n < 0) break
                if (output.size() + n > MAX_FILE_BYTES)
                    error("Archivo demasiado grande: máximo 10 MiB.")
                output.write(chunk, 0, n)
            }
            output.toByteArray()
        } ?: error("No se pudo abrir este archivo.")
        require(content.isNotEmpty()) { "El archivo está vacío." }
        val name = displayName(context, uri, "documento").replace(Regex("[/\\\\]"), "_")
        return PickedAttachment(ComposerAttachment.Document(
            name = name,
            mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream",
            content = content,
        ))
    }
}
