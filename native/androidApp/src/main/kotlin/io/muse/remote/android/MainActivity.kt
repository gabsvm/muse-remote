package io.muse.remote.android

import android.os.Bundle
import android.net.Uri
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import io.muse.remote.ui.PickedAttachment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import io.muse.remote.core.Screen
import java.util.concurrent.TimeUnit
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.sse.SSE
import io.muse.remote.core.MuseController
import io.muse.remote.core.MuseGateway
import io.muse.remote.ui.MuseApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val discovery = remember { AndroidLanDiscovery(applicationContext) }
            val controller = remember {
                MuseController(
                    gateway = MuseGateway(HttpClient(OkHttp) {
                        followRedirects = false
                        expectSuccess = false
                        install(SSE)
                        engine {
                            config {
                                // session/list may take 180 s on a cold Muse host.
                                readTimeout(205, TimeUnit.SECONDS)
                                connectTimeout(15, TimeUnit.SECONDS)
                            }
                        }
                    }, ::pinnedLanClient),
                    credentials = AndroidCredentialsStore(applicationContext),
                    discovery = discovery,
                )
            }
            DisposableEffect(controller) {
                discovery.start()
                onDispose { discovery.stop(); controller.close() }
            }
            val state by controller.state.collectAsState()
            BackHandler(enabled = state.screen == Screen.Conversation) {
                controller.backToSessions()
            }
            val pickScope = rememberCoroutineScope()
            var deliverAttachment by remember {
                mutableStateOf<((PickedAttachment) -> Unit)?>(null)
            }
            fun onSelected(uri: Uri?, photo: Boolean) {
                if (uri == null) return
                val callback = deliverAttachment ?: return
                pickScope.launch {
                    try {
                        val result = withContext(Dispatchers.IO) {
                            if (photo) AndroidAttachmentReader.readPhoto(applicationContext, uri)
                            else AndroidAttachmentReader.readDocument(applicationContext, uri)
                        }
                        callback(result)
                    } catch (e: Exception) {
                        controller.reportError(e.message ?: "No se pudo adjuntar el archivo.")
                    }
                }
            }
            val photoPicker = rememberLauncherForActivityResult(
                ActivityResultContracts.PickVisualMedia()
            ) { uri -> onSelected(uri, true) }
            val filePicker = rememberLauncherForActivityResult(
                ActivityResultContracts.OpenDocument()
            ) { uri -> onSelected(uri, false) }

            MuseApp(controller, discovery, scanPair = {
                GmsBarcodeScanning.getClient(this@MainActivity).startScan()
                    .addOnSuccessListener { barcode ->
                        try {
                            val uri = Uri.parse(barcode.rawValue.orEmpty())
                            require(uri.scheme == "muse" && uri.host == "pair") { "QR de emparejamiento inválido" }
                            val url = uri.getQueryParameter("url") ?: error("Falta URL local")
                            val token = uri.getQueryParameter("token") ?: error("Falta token")
                            val pin = uri.getQueryParameter("pin") ?: error("Falta huella TLS")
                            val fallback = uri.getQueryParameter("fallback")
                            controller.connect(url, token, pin, fallback)
                        } catch (e: Exception) {
                            controller.reportError(e.message ?: "No se pudo leer el QR")
                        }
                    }
                    .addOnFailureListener { e -> controller.reportError("Escáner no disponible: ${e.message}") }
            }, pickImage = { callback ->
                deliverAttachment = callback
                photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }, pickDocument = { callback ->
                deliverAttachment = callback
                filePicker.launch(arrayOf("*/*"))
            })
        }
    }
}
