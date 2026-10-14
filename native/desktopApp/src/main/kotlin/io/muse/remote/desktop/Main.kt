package io.muse.remote.desktop

import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.sse.SSE
import io.muse.remote.core.MemoryCredentialsStore
import io.muse.remote.core.MuseController
import io.muse.remote.core.MuseGateway
import io.muse.remote.ui.MuseApp

fun main() = application {
    Window(onCloseRequest = ::exitApplication, title = "Muse Remote") {
        val controller = remember {
            MuseController(
                MuseGateway(HttpClient(CIO) {
                    followRedirects = false
                    expectSuccess = false
                    install(SSE)
                }),
                MemoryCredentialsStore(),
            )
        }
        DisposableEffect(controller) {
            onDispose { controller.close() }
        }
        MuseApp(controller)
    }
}
