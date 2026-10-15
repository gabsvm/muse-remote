package io.muse.remote.android

import android.os.Bundle
import android.net.Uri
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import io.muse.remote.core.Screen
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
            MuseApp(controller, discovery) {
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
            }
        }
    }
}
