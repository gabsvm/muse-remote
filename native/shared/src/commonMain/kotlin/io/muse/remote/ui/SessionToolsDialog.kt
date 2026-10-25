package io.muse.remote.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.muse.remote.core.*

private fun approvalName(value: String) = when (value) {
    "onRequest" -> "Preguntar cuando Muse lo solicite"
    "promptUnmatched" -> "Consultar permisos no definidos"
    "denyUnmatched" -> "Denegar permisos no definidos"
    "allowAll" -> "Permitir todo (riesgoso)"
    else -> value
}

/**
 * Real MSP operations only. UI does not claim compaction completed or usage is live.
 * Dangerous approval widening and irreversible context compaction require confirmation.
 */
@Composable
internal fun SessionToolsDialog(state: MuseState, controller: MuseController, onDismiss: () -> Unit) {
    var confirmation by remember { mutableStateOf<String?>(null) }
    val idle = state.sessionReady && !state.working && !state.sending && !state.toolsSaving
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Herramientas de sesión") },
        text = {
            Column(Modifier.heightIn(max = 490.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (state.toolsLoading || state.toolsSaving) LinearProgressIndicator(Modifier.fillMaxWidth())
                state.toolsError?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                Text("Uso observado", style = MaterialTheme.typography.titleSmall)
                val usage = state.usage
                if (usage == null) {
                    Text("Muse todavía no informó una medición de cuota.",
                        style = MaterialTheme.typography.bodySmall)
                } else {
                    Text("Plan: " + usage.tier, style = MaterialTheme.typography.bodyMedium)
                    Text("Ventana: " + usage.windowUsedPercent + "% · Semanal: " +
                        usage.weeklyUsedPercent + "%", style = MaterialTheme.typography.bodySmall)
                    Text("Última observación del CLI, no una lectura en vivo.",
                        style = MaterialTheme.typography.labelSmall)
                }
                TextButton(onClick = controller::refreshSessionTools, enabled = !state.toolsLoading) {
                    Text("Releer datos observados")
                }
                OutlinedButton(onClick = controller::diagnoseQuota,
                    enabled = !state.usageChecking) {
                    Text("Consultar cuota desde Muse Code")
                }
                if (state.usageChecking) LinearProgressIndicator(Modifier.fillMaxWidth())
                state.usageDiagnosis?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                HorizontalDivider()
                Text("Aprobaciones", style = MaterialTheme.typography.titleSmall)
                Text("Actual: " + (state.approvalMode?.let(::approvalName) ?: "No confirmado"),
                    style = MaterialTheme.typography.bodySmall)
                state.let {
                    var approvalExpanded by remember { mutableStateOf(false) }
                    Box {
                        OutlinedButton(onClick = { approvalExpanded = true }, enabled = idle) {
                            Text("Cambiar política de aprobación ▾")
                        }
                        DropdownMenu(expanded = approvalExpanded,
                            onDismissRequest = { approvalExpanded = false }) {
                            approvalModes.forEach { mode ->
                                DropdownMenuItem(text = { Text(approvalName(mode)) },
                                    onClick = {
                                        approvalExpanded = false
                                        if (mode != state.approvalMode) {
                                            if (mode == "allowAll") confirmation = "mode:allowAll"
                                            else controller.setApprovalMode(mode)
                                        }
                                    })
                            }
                        }
                    }
                }
                Text("Los permisos dependen de la configuración del host. " +
                    "Permitir todo puede ejecutar comandos sin confirmación.",
                    style = MaterialTheme.typography.bodySmall)
                HorizontalDivider()
                Text("Conversación", style = MaterialTheme.typography.titleSmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { confirmation = "fork" }, enabled = idle) {
                        Text("Bifurcar")
                    }
                    OutlinedButton(onClick = { confirmation = "compact" }, enabled = idle) {
                        Text("Compactar")
                    }
                }
                Text("Bifurcar crea otra sesión sin eliminar la actual. Compactar reduce " +
                    "el contexto del hilo y se procesa de forma asíncrona en Muse.",
                    style = MaterialTheme.typography.bodySmall)
                HorizontalDivider()
                Text("Skills del host (" + state.skills.size + ")",
                    style = MaterialTheme.typography.titleSmall)
                if (state.skills.isEmpty()) {
                    Text("Sin skills disponibles o catálogo no cargado.",
                        style = MaterialTheme.typography.bodySmall)
                } else {
                    state.skills.take(25).forEach { skill ->
                        Column {
                            Text("/" + skill.selector + " · " + skill.title,
                                style = MaterialTheme.typography.labelLarge)
                            if (skill.description.isNotBlank())
                                Text(skill.description, style = MaterialTheme.typography.bodySmall,
                                    maxLines = 2)
                        }
                    }
                    if (state.skills.size > 25) Text(
                        "Mostrando las primeras 25; las restantes siguen disponibles en Muse.",
                        style = MaterialTheme.typography.labelSmall)
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cerrar") } },
    )
    confirmation?.let { action ->
        val isAll = action == "mode:allowAll"
        AlertDialog(onDismissRequest = { confirmation = null },
            title = { Text(when(action) {
                "fork" -> "Crear rama de este chat"
                "compact" -> "Compactar conversación"
                else -> "Cambiar permisos"
            }) },
            text = { Text(when(action) {
                "fork" -> "Se creará una sesión nueva desde los turnos completados. No se borra la conversación original."
                "compact" -> "Muse podrá resumir y descartar contexto anterior de esta sesión. No se puede garantizar recuperar el contexto compactado."
                else -> "Permitir todo puede ejecutar comandos y modificar archivos sin pedir confirmación. Solo usalo en un entorno confiable."
            }) },
            confirmButton = { TextButton(onClick = {
                confirmation = null
                when(action) {
                    "fork" -> { onDismiss(); controller.forkCurrentSession() }
                    "compact" -> controller.compactCurrentSession()
                    else -> if (isAll) controller.setApprovalMode("allowAll")
                }
            }) { Text("Confirmar") } },
            dismissButton = { TextButton(onClick = { confirmation = null }) { Text("Cancelar") } },
        )
    }
}
