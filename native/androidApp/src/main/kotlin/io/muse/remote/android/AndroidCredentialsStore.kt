package io.muse.remote.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import io.muse.remote.core.CredentialsStore
import io.muse.remote.core.ServerCredentials
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Token encrypted at rest using a non-exportable Android Keystore AES-256 key.
 * URL and last session are stored as regular preferences; the token is not.
 * No credentials are part of an Android backup (manifest: allowBackup=false).
 */
class AndroidCredentialsStore(context: Context) : CredentialsStore {
    private val prefs = context.getSharedPreferences("muse_remote_secure_v1", Context.MODE_PRIVATE)
    private val alias = "muse_remote_token_aes_v1"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return generator.generateKey()
    }

    private fun encode(raw: ByteArray): String =
        Base64.encodeToString(raw, Base64.NO_WRAP)

    private fun decode(raw: String): ByteArray =
        Base64.decode(raw, Base64.NO_WRAP)

    override fun save(value: ServerCredentials) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(value.token.toByteArray(Charsets.UTF_8))
        prefs.edit()
            .putString("url", value.base)
            .putString("token_iv", encode(cipher.iv))
            .putString("token_payload", encode(encrypted))
            .apply()
    }

    override fun read(): ServerCredentials? {
        val url = prefs.getString("url", null) ?: return null
        val iv = prefs.getString("token_iv", null) ?: return null
        val payload = prefs.getString("token_payload", null) ?: return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, decode(iv)))
            ServerCredentials(url, String(cipher.doFinal(decode(payload)), Charsets.UTF_8))
        } catch (_: Exception) {
            // Key may be invalidated by OS or device changes. Never return corrupt data.
            clear()
            null
        }
    }

    override fun clear() {
        prefs.edit().clear().apply()
    }

    override fun recentSession() = prefs.getString("recent_session", null)

    override fun saveRecentSession(id: String?) {
        prefs.edit().putString("recent_session", id).apply()
    }
}
