package io.muse.remote.android

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import io.muse.remote.core.DiscoveredServer
import io.muse.remote.core.LanDiscovery
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.net.Inet4Address

/**
 * Service discovery only locates a machine; its TXT fingerprint can be spoofed.
 * The TLS client refuses the host unless it presents the fingerprint paired by QR.
 */
@Suppress("DEPRECATION")
class AndroidLanDiscovery(context: Context) : LanDiscovery {
    private val manager = context.applicationContext.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val mutable = MutableStateFlow<List<DiscoveredServer>>(emptyList())
    override val services: StateFlow<List<DiscoveredServer>> = mutable
    private val found = mutableMapOf<String, DiscoveredServer>()
    private var active = false
    private val serviceType = "_museremote._tcp."

    private val listener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(regType: String) {}
        override fun onDiscoveryStopped(serviceType: String) {}
        override fun onServiceFound(info: NsdServiceInfo) {
            if (!active || !info.serviceType.startsWith("_museremote._tcp")) return
            manager.resolveService(info, object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {}
                override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                    if (!active) return
                    val address = serviceInfo.host
                    if (address !is Inet4Address) return
                    val port = serviceInfo.port
                    if (port !in 1024..65535) return
                    val pin = serviceInfo.attributes["fp"]?.let { String(it, Charsets.UTF_8) }
                        ?.lowercase() ?: return
                    if (!pin.matches(Regex("[a-f0-9]{64}"))) return
                    val result = DiscoveredServer(serviceInfo.serviceName,
                        "https://${address.hostAddress}:$port", pin)
                    synchronized(found) {
                        found[serviceInfo.serviceName] = result
                        mutable.value = found.values.toList()
                    }
                }
            })
        }
        override fun onServiceLost(info: NsdServiceInfo) {
            synchronized(found) {
                found.remove(info.serviceName)
                mutable.value = found.values.toList()
            }
        }
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
            active = false
            runCatching { manager.stopServiceDiscovery(this) }
        }
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
    }
    override fun start() {
        if (active) return
        active = true
        runCatching {
            manager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
        }.onFailure { active = false }
    }
    override fun stop() {
        if (!active) return
        active = false
        runCatching { manager.stopServiceDiscovery(listener) }
        synchronized(found) { found.clear(); mutable.value = emptyList() }
    }
}
