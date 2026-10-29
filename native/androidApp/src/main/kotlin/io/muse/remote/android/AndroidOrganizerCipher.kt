package io.muse.remote.android

import android.util.Base64
import io.muse.remote.core.OrganizerBackup
import io.muse.remote.core.OrganizerSyncCipher
import kotlinx.serialization.json.*
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/** Compatible with public/organizer-crypto.js. Passphrases never stored or transmitted. */
internal class AndroidOrganizerCipher : OrganizerSyncCipher {
    private val aad = "muse-remote-organizer-v1".toByteArray(Charsets.UTF_8)
    private val random = SecureRandom()
    private fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun un64(value: String, exact: Int? = null): ByteArray {
        require(value.length <= 260000 &&
            value.matches(Regex("[A-Za-z0-9+/]+={0,2}")) &&
            value.length % 4 == 0) { "Copia cifrada inválida." }
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        require(exact == null || bytes.size == exact)
        return bytes
    }
    private fun key(pass: String, salt: ByteArray): SecretKeySpec {
        require(pass.length in 12..128 &&
            pass.all { it.code in 32..126 }) {
            "Frase de 12 a 128 caracteres ASCII sin controles."
        }
        val spec = PBEKeySpec(pass.toCharArray(), salt, 310000, 256)
        return try {
            val raw = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            try { SecretKeySpec(raw, "AES") }
            finally { raw.fill(0) }
        } finally { spec.clearPassword() }
    }
    override fun encrypt(data: OrganizerBackup, passphrase: String): JsonObject {
        val payload = data.validated().toJson().toString().toByteArray(Charsets.UTF_8)
        require(payload.size <= 130000) { "Organización demasiado grande." }
        val salt = ByteArray(16).also(random::nextBytes)
        val iv = ByteArray(12).also(random::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key(passphrase, salt), GCMParameterSpec(128, iv))
        cipher.updateAAD(aad)
        return buildJsonObject {
            put("v", 1);put("salt", b64(salt));put("iv", b64(iv))
            put("ciphertext", b64(cipher.doFinal(payload)))
        }
    }
    override fun decrypt(envelope: JsonObject, passphrase: String): OrganizerBackup {
        require((envelope["v"] as? JsonPrimitive)?.intOrNull == 1) {
            "Versión incompatible."
        }
        val salt = un64(envelope["salt"]?.jsonPrimitive?.content ?: "", 16)
        val iv = un64(envelope["iv"]?.jsonPrimitive?.content ?: "", 12)
        val ciphertext = un64(envelope["ciphertext"]?.jsonPrimitive?.content ?: "")
        require(ciphertext.size in 16..196608) { "Copia cifrada inválida." }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(passphrase, salt), GCMParameterSpec(128, iv))
        cipher.updateAAD(aad)
        return try {
            OrganizerBackup.from(Json.parseToJsonElement(
                String(cipher.doFinal(ciphertext), Charsets.UTF_8)).jsonObject)
        } catch (_: Exception) {
            error("Frase incorrecta o copia modificada.")
        }
    }
}
