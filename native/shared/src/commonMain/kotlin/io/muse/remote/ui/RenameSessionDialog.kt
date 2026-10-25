package io.muse.remote.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Local aliases on Windows because Muse CLI does not currently expose session/rename there. */
@Composable
internal fun RenameSessionDialog(
    originalTitle: String,
    alias: String?,
    onSave: (String) -> Unit,
    onReset: () -> Unit,
    onDismiss: () -> Unit,
) {
    var edited by remember(originalTitle, alias) { mutableStateOf(alias ?: originalTitle) }
    val valid = edited.trim().isNotBlank() && edited.trim().length <= 80 &&
        edited.none { it.code < 32 || it.code == 127 }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Renombrar chat") },
        text = {
            Column {
                OutlinedTextField(
                    value = edited,
                    onValueChange = { edited = it.take(80) },
                    label = { Text("Nombre personalizado") },
                    singleLine = true,
                    isError = !valid,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "Se guarda en este teléfono. El nombre original del chat en Muse Code no se modifica.",
                    style = MaterialTheme.typography.bodySmall,
                )
                if (alias != null) TextButton(onClick = {
                    onReset()
                    onDismiss()
                }) { Text("Restaurar nombre original") }
            }
        },
        confirmButton = {
            TextButton(enabled = valid, onClick = {
                onSave(edited.trim())
                onDismiss()
            }) { Text("Guardar") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } },
    )
}
