package io.muse.remote.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.muse.remote.core.MuseController
import io.muse.remote.core.MuseState

/** Explicit read-only search, results only in RAM until this dialog is dismissed. */
@Composable
internal fun GlobalSearchDialog(
    state: MuseState,
    controller: MuseController,
    onDismiss: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var includeHidden by remember { mutableStateOf(false) }
    fun close() {
        controller.cancelGlobalSearch()
        onDismiss()
    }
    Dialog(onDismissRequest = ::close,
        properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            modifier = Modifier.fillMaxWidth(.96f).fillMaxHeight(.82f),
            shape = MaterialTheme.shapes.extraLarge,
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Buscar en conversaciones", style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.weight(1f))
                    IconButton(onClick = ::close) {
                        Icon(Icons.Default.Close, contentDescription = "Cerrar búsqueda")
                    }
                }
                Text("Consulta hasta 20 sesiones recientes mediante MSP. Solo lectura; " +
                    "no guarda un índice ni utiliza modelos. El historial disponible puede ser parcial.",
                    style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it.take(90) },
                    label = { Text("Buscar texto (mínimo 3 caracteres)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = includeHidden, onCheckedChange = { includeHidden = it },
                        enabled = !state.globalSearchBusy)
                    Text("Incluir chats ocultos", style = MaterialTheme.typography.bodySmall)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { controller.startGlobalSearch(query, includeHidden) },
                        enabled = !state.globalSearchBusy && query.trim().length >= 3,
                    ) { Text("Buscar") }
                    if (state.globalSearchBusy) TextButton(
                        onClick = controller::cancelGlobalSearch,
                    ) { Text("Cancelar") }
                }
                if (state.globalSearchBusy)
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                Text("Revisados: " + state.globalSearchDone + "/" + state.globalSearchTotal +
                    " · Coincidencias: " + state.globalSearchHits.size +
                    " · Errores de lectura: " + state.globalSearchFailed,
                    style = MaterialTheme.typography.labelSmall)
                state.globalSearchError?.let {
                    Text(it, color = MaterialTheme.colorScheme.error)
                }
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    itemsIndexed(
                        state.globalSearchHits,
                        key = { index, item ->
                            index.toString() + ":" + item.sessionId + ":" + item.itemId
                        },
                    ) { _, hit ->
                        ElevatedCard(onClick = { controller.openSession(hit.sessionId); onDismiss() }) {
                            Column(Modifier.fillMaxWidth().padding(12.dp)) {
                                Text(hit.sessionTitle, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    style = MaterialTheme.typography.titleSmall)
                                Text(if (hit.isUser) "Tu mensaje" else "Muse",
                                    style = MaterialTheme.typography.labelSmall)
                                Text(hit.preview, style = MaterialTheme.typography.bodySmall,
                                    maxLines = 4, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                    if (!state.globalSearchBusy && state.globalSearchDone > 0 &&
                        state.globalSearchHits.isEmpty()) item {
                        Text("No se encontraron coincidencias en el historial revisado.",
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}
