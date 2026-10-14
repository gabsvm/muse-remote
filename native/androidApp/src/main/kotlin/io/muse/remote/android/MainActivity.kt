package io.muse.remote.android

import android.os.Bundle
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
            val controller = remember {
                MuseController(
                    gateway = MuseGateway(HttpClient(OkHttp) {
                        followRedirects = false
                        expectSuccess = false
                        install(SSE)
                    }),
                    credentials = AndroidCredentialsStore(applicationContext),
                )
            }
            DisposableEffect(controller) {
                onDispose { controller.close() }
            }
            val state by controller.state.collectAsState()
            BackHandler(enabled = state.screen == Screen.Conversation) {
                controller.backToSessions()
            }
            MuseApp(controller)
        }
    }
}
