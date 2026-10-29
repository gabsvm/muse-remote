package io.muse.remote.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.muse.remote.core.MuseState
import io.muse.remote.core.MuseController

/** Passphrase is never persisted; all operations require explicit touch confirmation. */
@Composable
internal fun OrganizerSyncDialog(
    state: MuseState,
    controller: MuseController,
    onDismiss: () -> Unit,
) {
    var password by remember { mutableStateOf("") }
    var repeated by remember { mutableStateOf("") }
    var preferRemote by remember { mutableStateOf(false) }
    var confirmUpload by remember { mutableStateOf(false) }
    fun close() {
        password = ""; repeated = ""
        controller.clearOrganizerSyncPreview()
        onDismiss()
    }

    Dialog(onDismissRequest = ::close,
        properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxWidth(.95f).fillMaxHeight(.85f),
            shape = MaterialTheme.shapes.extraLarge) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Sincronización cifrada", Modifier.weight(1f),
                        style = MaterialTheme.typography.titleLarge)
                    IconButton(onClick = ::close) {
                        Icon(Icons.Default.Close, contentDescription = "Cerrar")
                    }
                }
                Text("Publica o recupera proyectos, asignaciones, nombres locales " +
                    "y chats fijados usando cifrado AES-256-GCM. " +
                    "No incluye conversaciones, tokens ni borradores. " +
                    "Los datos no se reemplazan sin tu confirmación.",
                    style = MaterialTheme.typography.bodySmall)
                Text("Frase de 12–128 caracteres ASCII. " +
                    "No se guarda ni se envía al servidor. Si la perdés, " +
                    "no podés recuperar la copia.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(
                    value = password, onValueChange = { password = it.take(128) },
                    label = { Text("Frase de cifrado") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = repeated, onValueChange = { repeated = it.take(128) },
                    label = { Text("Repetir frase (solo para subir)") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                )
                if (state.organizerSyncBusy) LinearProgressIndicator(Modifier.fillMaxWidth())
                state.organizerSyncError?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error)
                }
                state.organizerSyncInfo?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary)
                }
                Button(
                    onClick = {
                        val pass = password
                        password = ""; repeated = ""
                        controller.previewOrganizer(pass)
                    },
                    enabled = !state.organizerSyncBusy && password.length in 12..128,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Previsualizar copia remota") }
                OutlinedButton(
                    onClick = { confirmUpload = true },
                    enabled = !state.organizerSyncBusy && password.length in 12..128 &&
                        password == repeated,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Subir mi organización cifrada") }
                state.organizerSyncPreview?.let { remote ->
                    HorizontalDivider()
                    Text("Copia remota (revisión " + state.organizerSyncRevision + ")",
                        style = MaterialTheme.typography.titleSmall)
                    Text(remote.projects.size.toString() + " proyectos · " +
                        remote.pinned.size + " fijados · " +
                        remote.aliases.size + " nombres · " +
                        remote.assignments.size + " asignaciones",
                        style = MaterialTheme.typography.bodySmall)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = preferRemote,
                            onCheckedChange = { preferRemote = it })
                        Text("Preferir nombres/asignaciones remotas en conflictos",
                            style = MaterialTheme.typography.bodySmall)
                    }
                    Button(
                        onClick = { controller.importOrganizer(preferRemote) },
                        enabled = !state.organizerSyncBusy,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Confirmar importación y combinar") }
                }
            }
        }
    }
    if (confirmUpload) AlertDialog(
        onDismissRequest = { confirmUpload = false },
        title = { Text("Actualizar copia cifrada") },
        text = { Text("Se sustituirá la copia cifrada guardada en tu PC. " +
            "Tus otros dispositivos conservarán sus datos locales hasta que los importes. " +
            "¿Confirmás la publicación?") },
        confirmButton = { TextButton(onClick = {
            confirmUpload = false
            val pass = password
            password = ""; repeated = ""
            controller.publishOrganizer(pass)
        }) { Text("Publicar") } },
        dismissButton = { TextButton(onClick = { confirmUpload = false }) {
            Text("Cancelar")
        } },
    )
}
