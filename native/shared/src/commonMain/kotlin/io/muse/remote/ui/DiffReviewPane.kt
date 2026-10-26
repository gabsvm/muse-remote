package io.muse.remote.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.muse.remote.core.parseDiffReview

/** Visual review of stored tool patches; no edits or code execution. */
@Composable
internal fun DiffReviewPane(raw: String, onBack: () -> Unit) {
    val parsed = remember(raw) { parseDiffReview(raw) }
    var selectedIndex by remember(raw) { mutableIntStateOf(-1) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = {
                if (selectedIndex >= 0) selectedIndex = -1 else onBack()
            }) {
                Icon(Icons.Default.ChevronLeft, null, Modifier.size(18.dp))
                Text(if (selectedIndex >= 0) "Archivos" else "Volver")
            }
            Spacer(Modifier.weight(1f))
            Text(if (parsed.recognized) "${parsed.files.size} archivos" else "Datos del parche",
                style = MaterialTheme.typography.labelSmall)
        }
        if (!parsed.recognized) {
            Text("Este formato de parche no permite separar archivos. Se muestra el original, " +
                "sin interpretarlo como un diff.", style = MaterialTheme.typography.bodySmall)
            SelectionContainer {
                LazyColumn {
                    item {
                        Text(parsed.fallback, fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        } else if (selectedIndex < 0) {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                itemsIndexed(parsed.files, key = { index, f -> "$index:${f.path}" }) { index, file ->
                    ElevatedCard(onClick = { selectedIndex = index }) {
                        Row(Modifier.fillMaxWidth().padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Description, contentDescription = null)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(file.path, maxLines = 2, overflow = TextOverflow.Ellipsis,
                                    style = MaterialTheme.typography.titleSmall)
                                Text("+${file.additions}  −${file.removals} · ${file.lines.size} líneas",
                                    style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                }
            }
        } else {
            val file = parsed.files.getOrNull(selectedIndex)
            if (file != null) {
                Text(file.path, style = MaterialTheme.typography.titleSmall,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                SelectionContainer {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                        itemsIndexed(file.lines, key = { index, _ -> index }) { _, line ->
                            val background = when (line.type) {
                                "added" -> MaterialTheme.colorScheme.primaryContainer.copy(alpha = .55f)
                                "removed" -> MaterialTheme.colorScheme.errorContainer.copy(alpha = .6f)
                                "hunk" -> MaterialTheme.colorScheme.surfaceVariant
                                else -> MaterialTheme.colorScheme.surface
                            }
                            Surface(color = background,
                                shape = RoundedCornerShape(3.dp)) {
                                Text(line.value.ifEmpty { " " },
                                    Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp),
                                    fontFamily = FontFamily.Monospace,
                                    style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
        }
    }
}
