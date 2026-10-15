package io.muse.remote.android

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.sse.SSE
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/** Exact SHA-256 leaf certificate pin from a QR scanned at the trusted PC. */
internal fun pinnedLanClient(fingerprint: String): HttpClient {
    require(fingerprint.matches(Regex("[a-f0-9]{64}")))
    val expected = fingerprint.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    fun matches(cert: X509Certificate): Boolean {
        cert.checkValidity()
        return MessageDigest.isEqual(
            MessageDigest.getInstance("SHA-256").digest(cert.encoded), expected
        )
    }
    val trust = object : X509TrustManager {
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            throw CertificateException("Client certificates unsupported")
        }
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            val cert = chain?.firstOrNull() ?: throw CertificateException("Missing TLS certificate")
            if (!matches(cert)) throw CertificateException("La identidad TLS de la PC no coincide con el QR")
        }
    }
    val tls = SSLContext.getInstance("TLS")
    tls.init(null, arrayOf<TrustManager>(trust), SecureRandom())
    return HttpClient(OkHttp) {
        followRedirects = false
        expectSuccess = false
        install(SSE)
        engine {
            config {
                sslSocketFactory(tls.socketFactory, trust)
                // IP addresses may change with DHCP. The exact certificate pin
                // replaces hostname identity; never use this for unpinned URLs.
                hostnameVerifier { _, session ->
                    runCatching { matches(session.peerCertificates.first() as X509Certificate) }
                        .getOrDefault(false)
                }
            }
        }
    }
}
