package io.muse.remote.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.muse.remote.core.MuseController
import io.muse.remote.core.MuseState

/**
 * Subagents are identified by their durable MSP subagentId.
 * Only a deliberate confirmation sends any command to the parent CLI.
 */
@Composable
internal fun SubagentsPane(state: MuseState, controller: MuseController) {
    var action by remember(state.sessionId) { mutableStateOf<Pair<String, String>?>(null) }
    var body by remember(action) { mutableStateOf("") }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Subagentes de esta conversación", style = MaterialTheme.typography.titleSmall)
        Text("Estados y resultados obtenidos del historial MSP. " +
            "Enviar instrucciones puede utilizar la cuota de Muse Code.",
            style = MaterialTheme.typography.bodySmall)
        if (state.subagentBusy) LinearProgressIndicator(Modifier.fillMaxWidth())
        state.subagentError?.let {
            Text(it, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (state.subagents.isEmpty()) item {
                Text("No se han registrado subagentes en el historial cargado.")
            }
            items(state.subagents, key = { it.subagentId }) { agent ->
                ElevatedCard {
                    Column(Modifier.fillMaxWidth().padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Row {
                            Text(agent.name, Modifier.weight(1f),
                                style = MaterialTheme.typography.titleSmall)
                            Text(agent.controlStatus.ifBlank { agent.status.ifBlank { "Sin estado" } },
                                style = MaterialTheme.typography.labelSmall)
                        }
                        Text("Agente: " + agent.subagentId.take(18),
                            style = MaterialTheme.typography.labelSmall)
                        if (agent.summary.isNotBlank()) Text(agent.summary,
                            style = MaterialTheme.typography.bodySmall)
                        if (agent.resultText.isNotBlank()) {
                            SelectionContainer {
                                Text(agent.resultText.take(2400),
                                    style = MaterialTheme.typography.bodySmall)
                            }
                            if (agent.resultText.length > 2400)
                                Text("Resultado acortado para lectura móvil.",
                                    style = MaterialTheme.typography.labelSmall)
                        }
                        if (agent.artifactCount > 0)
                            Text("Referencias de artefactos: " + agent.artifactCount,
                                style = MaterialTheme.typography.labelSmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(onClick = { action = agent.subagentId to "subagent/sendMessage" },
                                enabled = state.sessionReady && !state.subagentBusy) {
                                Text("Mensaje")
                            }
                            TextButton(onClick = { action = agent.subagentId to "subagent/followupTask" },
                                enabled = state.sessionReady && !state.subagentBusy) {
                                Text("Seguimiento")
                            }
                            if (agent.running) TextButton(
                                onClick = { action = agent.subagentId to "subagent/stop" },
                                enabled = state.sessionReady && !state.subagentBusy) {
                                Text("Detener", color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            }
        }
    }

    action?.let { (id, method) ->
        val isStop = method == "subagent/stop"
        AlertDialog(onDismissRequest = { action = null },
            title = { Text(if (isStop) "Detener subagente" else
                if (method == "subagent/sendMessage") "Enviar mensaje al subagente"
                else "Asignar tarea de seguimiento") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(if (isStop)
                        "Se solicitará detener exclusivamente este subagente. El trabajo parcial podría perderse."
                        else "La solicitud puede iniciar o continuar trabajo de IA y consumir tu suscripción. " +
                            "No se ejecutará hasta que confirmes.",
                        style = MaterialTheme.typography.bodyMedium)
                    if (!isStop) OutlinedTextField(
                        value = body,
                        onValueChange = { body = it.take(8000) },
                        label = { Text("Instrucciones") },
                        minLines = 2, maxLines = 5,
                    )
                }
            },
            confirmButton = { TextButton(enabled = isStop || body.isNotBlank(), onClick = {
                controller.controlSubagent(id, method, body)
                action = null
            }) { Text(if (isStop) "Detener" else "Enviar ahora") } },
            dismissButton = { TextButton(onClick = { action = null }) { Text("Cancelar") } },
        )
    }
}
