package io.muse.remote.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.muse.remote.core.MuseController
import io.muse.remote.core.MuseState

/**
 * Workflow controls backed by actual MSP contracts (no simulated capabilities).
 * Mutating actions are explicitly user-initiated and never run from composition effects.
 */
@Composable
internal fun WorkflowPanel(
    state: MuseState,
    controller: MuseController,
    onDismiss: () -> Unit,
) {
    var tab by remember { mutableStateOf(0) }
    var cancelQueued by remember { mutableStateOf<String?>(null) }
    var stopTask by remember { mutableStateOf<String?>(null) }
    var chosenSkill by remember { mutableStateOf<String?>(null) }
    var skillArgs by remember(chosenSkill) { mutableStateOf("") }

    Dialog(onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            Modifier.fillMaxWidth(0.95f).fillMaxHeight(0.82f),
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Centro de trabajo", style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.weight(1f))
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "Cerrar")
                    }
                }
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("Cola", "Tareas", "Cambios", "Skills", "Git").forEachIndexed { n, name ->
                        FilterChip(selected = tab == n, onClick = { tab = n },
                            label = { Text(name) })
                    }
                }
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                when (tab) {
                    0 -> {
                        Text("Mensajes pendientes", style = MaterialTheme.typography.titleSmall)
                        Text("Muse permite cancelar únicamente los turnos enviados desde este " +
                            "teléfono cuyo identificador conocemos. Los demás son solo lectura.",
                            style = MaterialTheme.typography.bodySmall)
                        Spacer(Modifier.height(8.dp))
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(state.queuedSubmitted, key = { it.turnId }) { own ->
                                ElevatedCard {
                                    Column(Modifier.fillMaxWidth().padding(12.dp)) {
                                        Text(own.text, maxLines = 4, overflow = TextOverflow.Ellipsis)
                                        Text("Turno confirmado: " + own.turnId.take(12),
                                            style = MaterialTheme.typography.labelSmall)
                                        TextButton(onClick = { cancelQueued = own.turnId },
                                            enabled = !state.queueBusy) {
                                            Text("Retirar de la cola")
                                        }
                                    }
                                }
                            }
                            if (state.queuedInputs.isNotEmpty()) {
                                item { Text("Cola informada por Muse (solo lectura)",
                                    style = MaterialTheme.typography.labelLarge) }
                                items(state.queuedInputs, key = { it.sequence }) { q ->
                                    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                                        Text(q.text, maxLines = 3,
                                            overflow = TextOverflow.Ellipsis)
                                        Text("Secuencia " + q.sequence + " · sin ID cancelable confirmado",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                            if (state.queuedInputs.isEmpty() && state.queuedSubmitted.isEmpty())
                                item { Text("No hay mensajes pendientes conocidos.") }
                        }
                    }
                    1 -> {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Tareas activas", Modifier.weight(1f),
                                style = MaterialTheme.typography.titleSmall)
                            TextButton(onClick = controller::refreshProductivity,
                                enabled = !state.tasksLoading) { Text("Actualizar") }
                        }
                        if (state.tasksLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
                        state.tasksError?.let {
                            Text(it, color = MaterialTheme.colorScheme.error)
                        }
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (state.tasks.isEmpty()) item { Text("Sin tareas activas conocidas.") }
                            items(state.tasks, key = { it.taskId }) { task ->
                                ElevatedCard {
                                    Column(Modifier.fillMaxWidth().padding(12.dp)) {
                                        Text(task.title, style = MaterialTheme.typography.titleSmall)
                                        Text(task.mode + " · " + task.taskId.take(14),
                                            style = MaterialTheme.typography.labelSmall)
                                        if (task.mode == "background") TextButton(
                                            onClick = { stopTask = task.taskId },
                                            enabled = !state.tasksLoading) {
                                            Text("Detener tarea")
                                        }
                                    }
                                }
                            }
                        }
                    }
                    2 -> {
                        Text("Cambios producidos por Muse",
                            style = MaterialTheme.typography.titleSmall)
                        Text("Parches de herramientas almacenados por el host; lectura sin modificar archivos.",
                            style = MaterialTheme.typography.bodySmall)
                        if (state.patchBusy) LinearProgressIndicator(Modifier.fillMaxWidth())
                        state.patchError?.let {
                            Text(it, color = MaterialTheme.colorScheme.error)
                        }
                        if (state.patchPreview != null) {
                            TextButton(onClick = controller::dismissPatch) { Text("Volver a los cambios") }
                            SelectionContainer {
                                Box(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                                    Text(state.patchPreview, fontFamily = FontFamily.Monospace,
                                        style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        } else {
                            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (state.patches.isEmpty()) item {
                                    Text("Esta sesión no tiene parches almacenados visibles.")
                                }
                                items(state.patches, key = { it.itemId }) { patch ->
                                    ElevatedCard {
                                        Column(Modifier.fillMaxWidth().padding(12.dp)) {
                                            Text("Cambio " + patch.itemId.take(12))
                                            Text("${patch.files} archivos · +${patch.added} / −${patch.removed} líneas",
                                                style = MaterialTheme.typography.bodySmall)
                                            TextButton(onClick = {
                                                controller.fetchPatch(patch.itemId, patch.refId)
                                            }, enabled = !state.patchBusy) {
                                                Text("Ver parche almacenado")
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    3 -> {
                        Text("Skills del host", style = MaterialTheme.typography.titleSmall)
                        Text("Ejecutar una skill puede iniciar un turno y utilizar tu cuota. " +
                            "Solo se ejecuta cuando confirmás.", style = MaterialTheme.typography.bodySmall)
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (state.skills.isEmpty()) item {
                                Text("No se informó ninguna skill. Abrí Herramientas → Actualizar datos.")
                            }
                            items(state.skills, key = { it.selector }) { skill ->
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text("/" + skill.selector,
                                            style = MaterialTheme.typography.titleSmall)
                                        Text(skill.description,
                                            style = MaterialTheme.typography.bodySmall,
                                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    }
                                    TextButton(onClick = { chosenSkill = skill.selector },
                                        enabled = state.sessionReady && !state.sending) {
                                        Text("Usar")
                                    }
                                }
                            }
                        }
                    }
                    else -> {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Worktrees Git", Modifier.weight(1f),
                                style = MaterialTheme.typography.titleSmall)
                            TextButton(onClick = controller::refreshWorktrees,
                                enabled = !state.worktreeLoading) { Text("Consultar") }
                        }
                        Text("Vista de solo lectura del repositorio de la PC; no crea ramas ni ejecuta comandos.",
                            style = MaterialTheme.typography.bodySmall)
                        if (state.worktreeLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
                        state.worktreeError?.let {
                            Text(it, color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodySmall)
                        }
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (state.worktrees.isEmpty()) item {
                                Text("Sin worktrees disponibles. Consultá desde una sesión asociada a un repositorio.")
                            }
                            items(state.worktrees, key = { it.path }) { worktree ->
                                ElevatedCard {
                                    Column(Modifier.fillMaxWidth().padding(12.dp)) {
                                        Text(worktree.branch.ifBlank { "Detached HEAD" },
                                            style = MaterialTheme.typography.titleSmall)
                                        Text(worktree.path,
                                            style = MaterialTheme.typography.bodySmall)
                                        Text((if (worktree.main) "Checkout principal" else "Worktree") +
                                            " · " + worktree.activeSessions + " sesiones activas",
                                            style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if (cancelQueued != null) AlertDialog(onDismissRequest = { cancelQueued = null },
        title = { Text("Retirar mensaje") },
        text = { Text("Solo se retirará este turno pendiente. Si ya empezó, Muse rechazará la operación.") },
        confirmButton = { TextButton(onClick = {
            cancelQueued?.let(controller::cancelQueued)
            cancelQueued = null
        }) { Text("Retirar") } },
        dismissButton = { TextButton(onClick = { cancelQueued = null }) { Text("Cancelar") } })
    if (stopTask != null) AlertDialog(onDismissRequest = { stopTask = null },
        title = { Text("Detener tarea de fondo") },
        text = { Text("La ejecución de esta tarea podría interrumpirse. No detiene otros trabajos.") },
        confirmButton = { TextButton(onClick = {
            stopTask?.let(controller::stopBackgroundTask)
            stopTask = null
        }) { Text("Detener") } },
        dismissButton = { TextButton(onClick = { stopTask = null }) { Text("Cancelar") } })
    if (chosenSkill != null) AlertDialog(onDismissRequest = { chosenSkill = null },
        title = { Text("Ejecutar /" + chosenSkill) },
        text = {
            Column {
                Text("Esta acción puede iniciar una petición al modelo y consumir cuota.")
                OutlinedTextField(value = skillArgs,
                    onValueChange = { skillArgs = it.take(8000) },
                    label = { Text("Argumentos (opcional)") })
            }
        },
        confirmButton = { TextButton(onClick = {
            chosenSkill?.let { controller.runSkill(it, skillArgs) }
            chosenSkill = null
            onDismiss()
        }) { Text("Ejecutar ahora") } },
        dismissButton = { TextButton(onClick = { chosenSkill = null }) { Text("Cancelar") } })
}
