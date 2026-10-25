package io.muse.remote.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.muse.remote.core.MuseController
import io.muse.remote.core.MuseState
import io.muse.remote.core.reasoningEffortLevels

/** Per-session model and effort choices sent over MSP to the already-running PC bridge. */
@Composable
internal fun ModelSettingsBar(state: MuseState, controller: MuseController) {
    var contributorOpen by remember { mutableStateOf(false) }
    val canEdit = state.sessionReady && !state.working && !state.sending &&
        !state.modelSettingsSaving && !state.modelSettingsLoading
    val currentModel = state.models.firstOrNull { it.id == state.activeModelId }
    val modelLabel = currentModel?.label ?: state.activeModelId
        ?: if (state.modelSettingsLoading) "Consultando…" else "Sin confirmar"
    val effortLabel = state.reasoningEffort?.let(::effortLabel) ?: "Sin confirmar"

    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Modelo", style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(3.dp))
                ChoiceDropdown(
                    label = modelLabel,
                    options = state.models.map { it.id to it.label },
                    selected = state.activeModelId,
                    enabled = canEdit && state.models.isNotEmpty(),
                    onSelect = controller::changeModel,
                )
            }
            Column(Modifier.weight(.80f)) {
                Text("Razonamiento", style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(3.dp))
                ChoiceDropdown(
                    label = effortLabel,
                    options = reasoningEffortLevels.map { it to effortLabel(it) },
                    selected = state.reasoningEffort,
                    enabled = canEdit && state.models.isNotEmpty(),
                    onSelect = controller::changeReasoningEffort,
                )
            }
        }
        if (state.modelSettingsLoading || state.modelSettingsSaving) {
            Spacer(Modifier.height(6.dp))
            LinearProgressIndicator(Modifier.fillMaxWidth())
        }
        if (state.modelSettingsError != null) {
            Spacer(Modifier.height(4.dp))
            Text(state.modelSettingsError, style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error)
        }
        if (state.models.isEmpty() && !state.modelSettingsLoading && state.sessionReady) {
            TextButton(onClick = controller::refreshModelSettings,
                modifier = Modifier.align(Alignment.End)) { Text("Reintentar catálogo") }
        }
        TextButton(onClick = {
            controller.refreshContributor()
            contributorOpen = true
        }) {
            Text("Contributor · configuración de la PC")
        }
        if (state.working) {
            Text("Los ajustes se pueden cambiar al terminar el turno.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (state.reasoningEffort == null && !state.modelSettingsLoading &&
            state.models.isNotEmpty()) {
            Text("El nivel actual no está confirmado; elegí uno para aplicarlo.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if (contributorOpen) ContributorSettingsDialog(state, controller,
        onDismiss = { contributorOpen = false })
}

private fun effortLabel(value: String): String = when (value) {
    "none" -> "Sin razonamiento"
    "minimal" -> "Mínimo"
    "low" -> "Bajo"
    "medium" -> "Medio"
    "high" -> "Alto"
    "xhigh" -> "Muy alto"
    "max" -> "Máximo"
    "ultra" -> "Ultra"
    else -> value
}

@Composable
private fun ChoiceDropdown(
    label: String,
    options: List<Pair<String,String>>,
    selected: String?,
    enabled: Boolean,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    LaunchedEffect(enabled) { if (!enabled) expanded = false }
    Box {
        OutlinedButton(onClick = { expanded = true },
            enabled = enabled,
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp),
        ) {
            Text(label, modifier = Modifier.weight(1f, fill = false),
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Medium)
            Spacer(Modifier.width(4.dp))
            Text("▾", style = MaterialTheme.typography.labelMedium)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (id, name) ->
                DropdownMenuItem(
                    text = {
                        Text(if (id == selected) "✓ $name" else name,
                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                    },
                    onClick = {
                        expanded = false
                        if (id != selected) onSelect(id)
                    },
                )
            }
        }
    }
}
