package io.muse.remote.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import io.muse.remote.core.CredentialsStore
import io.muse.remote.core.ServerCredentials
import io.muse.remote.core.RemoteProject
import org.json.JSONArray
import org.json.JSONObject
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
    private val organizer = context.getSharedPreferences("muse_remote_organizer_v1", Context.MODE_PRIVATE)
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
            .putString("pin", value.pin)
            .putString("fallback", value.fallbackUrl)
            .putString("token_iv", encode(cipher.iv))
            .putString("token_payload", encode(encrypted))
            .commit().also { check(it) { "No se pudo guardar el emparejamiento cifrado." } }
    }

    override fun read(): ServerCredentials? {
        val url = prefs.getString("url", null) ?: return null
        val iv = prefs.getString("token_iv", null) ?: return null
        val payload = prefs.getString("token_payload", null) ?: return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, decode(iv)))
            ServerCredentials(
                url,
                String(cipher.doFinal(decode(payload)), Charsets.UTF_8),
                prefs.getString("pin", null),
                prefs.getString("fallback", null),
            )
        } catch (_: Exception) {
            // Never wipe the encrypted pairing, archived-session preferences
            // or recent-session state merely because Keystore read failed.
            // A transient OS failure is not an explicit sign-out.
            null
        }
    }

    override fun projects(): List<RemoteProject> = runCatching {
        val array = JSONArray(organizer.getString("projects", "[]") ?: "[]")
        (0 until minOf(array.length(), 100)).mapNotNull { n ->
            val x = array.optJSONObject(n) ?: return@mapNotNull null
            val id = x.optString("id").takeIf(String::isNotBlank) ?: return@mapNotNull null
            RemoteProject(id, x.optString("name").take(64), x.optString("workspace").take(512))
        }
    }.getOrDefault(emptyList())

    override fun saveProjects(value: List<RemoteProject>) {
        val array = JSONArray()
        value.take(100).forEach { p ->
            array.put(JSONObject().put("id", p.id).put("name", p.name).put("workspace", p.workspace))
        }
        check(organizer.edit().putString("projects", array.toString()).commit()) {
            "No se pudo guardar la lista de proyectos."
        }
    }

    override fun projectAssignments(): Map<String, String> = runCatching {
        val obj = JSONObject(organizer.getString("assignments", "{}") ?: "{}")
        obj.keys().asSequence().take(10000).associateWith { key -> obj.optString(key) }
    }.getOrDefault(emptyMap())

    override fun saveProjectAssignments(value: Map<String, String>) {
        val obj = JSONObject()
        value.entries.take(10000).forEach { obj.put(it.key, it.value) }
        check(organizer.edit().putString("assignments", obj.toString()).commit()) {
            "No se pudieron guardar los chats de los proyectos."
        }
    }

    override fun pinnedSessionIds(): Set<String> =
        organizer.getStringSet("pinned", emptySet())?.toSet() ?: emptySet()

    override fun savePinnedSessionIds(value: Set<String>) {
        check(organizer.edit().putStringSet("pinned", value).commit()) {
            "No se pudieron guardar los chats fijados."
        }
    }

    override fun hiddenSessionIds(): Set<String> =
        prefs.getStringSet("hidden_session_ids", emptySet())?.toSet() ?: emptySet()

    override fun hideSession(id: String) {
        val next = hiddenSessionIds() + id
        prefs.edit().putStringSet("hidden_session_ids", next).apply()
    }

    override fun restoreSession(id: String) {
        val next = hiddenSessionIds() - id
        prefs.edit().putStringSet("hidden_session_ids", next).apply()
    }

    override fun clear() {
        prefs.edit().clear().apply()
    }

    override fun recentSession() = prefs.getString("recent_session", null)

    override fun saveRecentSession(id: String?) {
        prefs.edit().putString("recent_session", id).apply()
    }
}
