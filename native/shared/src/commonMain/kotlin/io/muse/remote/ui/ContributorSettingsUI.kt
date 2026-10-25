package io.muse.remote.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.muse.remote.core.MuseController
import io.muse.remote.core.MuseState

/**
 * Host-wide Muse Code privacy preference (NOT a model-specific switch).
 * The bridge persists the setting; current serve process is not reconfigured
 * until it restarts. We never imply immediate activation.
 */
@Composable
internal fun ContributorSettingsDialog(
    state: MuseState,
    controller: MuseController,
    onDismiss: () -> Unit,
) {
    var pending by remember { mutableStateOf<Boolean?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Modo Contributor · Muse Code") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Preferencia de la PC para todas las sesiones Muse, no de un solo chat.",
                    style = MaterialTheme.typography.bodySmall)
                val stateText = when {
                    state.contributorLoading -> "Consultando el estado…"
                    !state.contributor.available -> "No disponible"
                    state.contributor.value == true -> "Activado en configuración"
                    state.contributor.value == false -> "Desactivado en configuración"
                    else -> "Sin confirmar"
                }
                Text(stateText, style = MaterialTheme.typography.titleSmall)
                state.contributor.reason?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text("Al activarlo, Meta puede utilizar mensajes, código, archivos, contexto y respuestas " +
                    "para entrenar modelos. A cambio, puede ofrecer más uso de tu plan. " +
                    "No lo uses con información privada o confidencial.",
                    style = MaterialTheme.typography.bodySmall)
                if (state.contributor.available) {
                    Button(onClick = { pending = state.contributor.value != true },
                        enabled = !state.contributorSaving && !state.contributorLoading) {
                        Text(if (state.contributor.value == true) "Desactivar Contributor"
                            else "Activar Contributor")
                    }
                }
                if (state.contributor.needsRestart) Text(
                    "Cambio guardado. Reiniciá el servidor Muse Remote en la PC para aplicarlo. " +
                    "El proceso que está ejecutándose puede seguir usando el estado anterior.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
                TextButton(onClick = controller::refreshContributor) { Text("Actualizar estado") }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cerrar") } },
    )
    pending?.let { enabled ->
        AlertDialog(
            onDismissRequest = { pending = null },
            title = { Text(if (enabled) "Confirmar Contributor" else "Desactivar Contributor") },
            text = { Text(if (enabled)
                "¿Aceptás expresamente que Meta pueda utilizar el contenido enviado a Muse Code " +
                    "para entrenar sus modelos? La elección afecta a toda esta PC y requiere reiniciar el puente."
                else "Se guardará el modo estándar para esta PC. Reiniciá Muse Remote para aplicar el cambio.") },
            confirmButton = {
                TextButton(onClick = {
                    controller.changeContributor(enabled, explicitConsent = enabled)
                    pending = null
                }) { Text(if (enabled) "Acepto y activar" else "Desactivar") }
            },
            dismissButton = { TextButton(onClick = { pending = null }) { Text("Cancelar") } },
        )
    }
}
