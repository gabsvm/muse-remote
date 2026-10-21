package io.muse.remote.core

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** mDNS is a locator, NOT proof of identity: TLS SHA-256 pin enforces identity. */
data class DiscoveredServer(
    val name: String,
    val url: String,
    val fingerprint: String,
)

interface LanDiscovery {
    val services: StateFlow<List<DiscoveredServer>>
    fun start()
    fun stop()
}

object EmptyLanDiscovery : LanDiscovery {
    override val services: StateFlow<List<DiscoveredServer>> =
        MutableStateFlow(emptyList())
    override fun start() {}
    override fun stop() {}
}
