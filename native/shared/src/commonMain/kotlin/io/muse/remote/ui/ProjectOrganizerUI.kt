package io.muse.remote.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.muse.remote.core.MuseController
import io.muse.remote.core.MuseState
import io.muse.remote.core.RemoteProject

/** Organizer is local to Android, separate from the Muse MSP session repository.
 * Grouping and pinning never deletes, moves or changes an upstream session.
 */
@Composable
internal fun ProjectFilterStrip(
    state: MuseState,
    selected: String,
    onSelected: (String) -> Unit,
    onAdd: () -> Unit,
    onManage: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.CenterVertically) {
        FilterChip(selected = selected == "all", onClick = { onSelected("all") },
            label = { Text("Todos") })
        FilterChip(selected = selected == "pinned", onClick = { onSelected("pinned") },
            label = { Text("Fijados") })
        FilterChip(selected = selected == "unassigned", onClick = { onSelected("unassigned") },
            label = { Text("Sin proyecto") })
        state.projects.forEach { project ->
            FilterChip(selected = selected == project.id,
                onClick = { onSelected(project.id) },
                label = { Text(project.name, maxLines = 1,
                    overflow = TextOverflow.Ellipsis) })
        }
        TextButton(onClick = onAdd) {
            Icon(Icons.Default.Add, contentDescription = null, Modifier.size(16.dp))
            Spacer(Modifier.width(4.dp))
            Text("Proyecto")
        }
        if (state.projects.isNotEmpty()) TextButton(onClick = onManage) {
            Text("Administrar")
        }
    }
}

@Composable
internal fun ProjectPicker(
    projects: List<RemoteProject>,
    selected: String?,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    val name = projects.firstOrNull { it.id == selected }?.name ?: "Sin proyecto"
    Box(modifier) {
        OutlinedButton(onClick = { expanded = true }) {
            Icon(Icons.Default.Folder, null, Modifier.size(17.dp))
            Spacer(Modifier.width(6.dp))
            Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.width(6.dp))
            Text("▾")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(text = { Text("Sin proyecto") }, onClick = {
                expanded = false
                onSelect(null)
            })
            projects.forEach { project ->
                DropdownMenuItem(text = { Text(project.name, maxLines = 1) }, onClick = {
                    expanded = false
                    onSelect(project.id)
                })
            }
        }
    }
}

@Composable
internal fun ProjectEditor(
    project: RemoteProject?,
    onDismiss: () -> Unit,
    onSave: (String, String) -> Unit,
    onDelete: (() -> Unit)? = null,
) {
    var name by remember(project?.id) { mutableStateOf(project?.name ?: "") }
    var workspace by remember(project?.id) { mutableStateOf(project?.workspace ?: "") }
    var confirmingDelete by remember { mutableStateOf(false) }
    if (confirmingDelete) {
        AlertDialog(onDismissRequest = { confirmingDelete = false },
            title = { Text("¿Quitar este proyecto?") },
            text = { Text("Los chats seguirán en Muse. Solo se quitará la agrupación local.") },
            confirmButton = { TextButton(onClick = {
                confirmingDelete = false
                onDelete?.invoke()
            }) { Text("Quitar proyecto") } },
            dismissButton = { TextButton(onClick = { confirmingDelete = false }) { Text("Cancelar") } })
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (project == null) "Nuevo proyecto" else "Editar proyecto") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(value = name, onValueChange = { name = it.take(64) },
                    label = { Text("Nombre del proyecto") }, singleLine = true)
                OutlinedTextField(value = workspace,
                    onValueChange = { workspace = it.take(512) },
                    label = { Text("Carpeta en la PC (opcional)") },
                    placeholder = { Text("C:\\Dev\\mi-proyecto") }, singleLine = true)
                Text("Esta carpeta se usará al crear un chat dentro del proyecto. " +
                    "No se moverán archivos ni conversaciones existentes.",
                    style = MaterialTheme.typography.bodySmall)
                if (onDelete != null) TextButton(onClick = { confirmingDelete = true }) {
                    Text("Eliminar agrupación", color = MaterialTheme.colorScheme.error)
                }
            }
        },
        confirmButton = {
            TextButton(enabled = name.trim().isNotBlank(), onClick = {
                onSave(name.trim(), workspace.trim())
            }) { Text("Guardar") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } },
    )
}

@Composable
internal fun ProjectManager(
    state: MuseState,
    controller: MuseController,
    onDismiss: () -> Unit,
) {
    var editing by remember { mutableStateOf<RemoteProject?>(null) }
    if (editing != null) {
        ProjectEditor(
            project = editing,
            onDismiss = { editing = null },
            onSave = { name, workspace ->
                controller.updateProject(editing!!.id, name, workspace)
                editing = null
            },
            onDelete = {
                controller.deleteProject(editing!!.id)
                editing = null
            },
        )
    }
    AlertDialog(onDismissRequest = onDismiss,
        title = { Text("Mis proyectos") },
        text = {
            Column(Modifier.heightIn(max = 380.dp)) {
                Text("Organización local de tus sesiones. No se eliminan chats.",
                    style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(10.dp))
                state.projects.forEach { project ->
                    TextButton(onClick = { editing = project }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.Folder, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(project.name, Modifier.weight(1f), maxLines = 1)
                        Text("Editar")
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cerrar") } })
}
