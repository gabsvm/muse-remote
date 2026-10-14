package io.muse.remote.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import io.muse.remote.core.*

private val Forest = Color(0xFF16754B)
private val Mint = Color(0xFF55D797)
private val Dark = Color(0xFF0E1713)
private val Panel = Color(0xFF18251E)
private val Light = Color(0xFFF4F7F3)
private val Ink = Color(0xFF15261D)

@Composable
fun MuseApp(controller: MuseController) {
    val state by controller.state.collectAsState()
    val dark = isSystemInDarkTheme()
    val colors = if (dark) darkColorScheme(
        primary = Mint, onPrimary = Dark, background = Dark, onBackground = Color(0xFFE8F2EB),
        surface = Panel, onSurface = Color(0xFFE8F2EB), surfaceVariant = Color(0xFF223428),
        outline = Color(0xFF475A4D),
    ) else lightColorScheme(
        primary = Forest, onPrimary = Color.White, background = Light, onBackground = Ink,
        surface = Color.White, onSurface = Ink, surfaceVariant = Color(0xFFE7F0E8),
        outline = Color(0xFF9BAFA0),
    )
    LaunchedEffect(controller) { controller.bootstrap() }
    MaterialTheme(colorScheme = colors) {
        Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
                when (state.screen) {
                    Screen.Login -> LoginScene(state, controller)
                    Screen.Sessions -> SessionScene(state, controller)
                    Screen.Conversation -> ConversationScene(state, controller)
                }
            }
        }
    }
}

@Composable
private fun LoginScene(state: MuseState, controller: MuseController) {
    var endpoint by remember(state.endpoint) { mutableStateOf(state.endpoint) }
    var token by remember { mutableStateOf("") }
    var showToken by remember { mutableStateOf(false) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.size(68.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(22.dp)),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Default.Terminal, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(34.dp)) }
        Spacer(Modifier.height(24.dp))
        Text("Muse Remote", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text(
            "Tu estación de trabajo, en cualquier lugar.",
            style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(36.dp))
        SectionCard {
            Text("CONEXIÓN SEGURA", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = endpoint, onValueChange = { endpoint = it }, modifier = Modifier.fillMaxWidth(),
                label = { Text("Dirección del servidor") },
                placeholder = { Text("https://muse.tu-tailnet.ts.net") },
                singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = token, onValueChange = { token = it }, modifier = Modifier.fillMaxWidth(),
                label = { Text("Token de acceso") },
                visualTransformation = if (showToken) androidx.compose.ui.text.input.VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    IconButton(onClick = { showToken = !showToken }) {
                        Icon(if (showToken) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                            contentDescription = if (showToken) "Ocultar token" else "Mostrar token")
                    }
                },
                singleLine = true,
            )
            Spacer(Modifier.height(18.dp))
            Button(
                enabled = !state.loading && endpoint.isNotBlank() && token.isNotBlank(),
                onClick = { controller.connect(endpoint, token) },
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(16.dp),
            ) {
                if (state.loading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else {
                    Text("Conectar", fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.width(8.dp))
                    Icon(Icons.Default.ArrowForward, null, Modifier.size(18.dp))
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(
            "Muse sigue ejecutándose en tu PC. Usa una URL HTTPS estable y el token que muestra el backend al iniciarse.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        ErrorNotice(state.error, controller::dismissError)
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun SessionScene(state: MuseState, controller: MuseController) {
    var search by remember { mutableStateOf("") }
    var createDialog by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Muse Remote", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Estación conectada", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            }
            IconButton(onClick = controller::refreshSessions) {
                Icon(Icons.Default.Refresh, contentDescription = "Actualizar sesiones")
            }
            IconButton(onClick = controller::logout) {
                Icon(Icons.Default.Logout, contentDescription = "Cerrar sesión")
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.22f))
        Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Tus sesiones", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text("${state.sessions.size} conversaciones sincronizadas", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                FilledTonalButton(
                    onClick = { createDialog = true },
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Icon(Icons.Default.Add, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Nueva")
                }
            }
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = search, onValueChange = { search = it },
                placeholder = { Text("Buscar por nombre o carpeta") },
                leadingIcon = { Icon(Icons.Default.Search, null) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                shape = RoundedCornerShape(18.dp),
            )
            Spacer(Modifier.height(12.dp))
            val shown = remember(state.sessions, search) {
                state.sessions.filter {
                    it.title.contains(search, true) || it.workspace.contains(search, true)
                }
            }
            if (shown.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(32.dp)) {
                        Icon(Icons.Default.FolderOpen, null, modifier = Modifier.size(46.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(14.dp))
                        Text(if (search.isBlank()) "Todavía no hay sesiones" else "Sin resultados",
                            style = MaterialTheme.typography.titleMedium)
                        Text(if (search.isBlank()) "Crea una sesión para comenzar." else "Prueba con otro término.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            } else {
                LazyColumn(contentPadding = PaddingValues(bottom = 26.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(shown, key = { it.id }) { session ->
                        SessionRow(session) { controller.openSession(session.id) }
                    }
                }
            }
        }
    }
    if (createDialog) {
        var workspace by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { createDialog = false },
            title = { Text("Nueva sesión") },
            text = {
                Column {
                    Text("Indica la carpeta de trabajo de tu PC. Déjala vacía para una sesión sin carpeta.")
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = workspace, onValueChange = { workspace = it },
                        label = { Text("Carpeta en la PC") },
                        placeholder = { Text("C:\\Dev\\mi-proyecto") },
                        singleLine = true,
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { createDialog = false; controller.createSession(workspace) }) { Text("Crear") }
            },
            dismissButton = { TextButton(onClick = { createDialog = false }) { Text("Cancelar") } },
        )
    }
    ErrorPopup(state.error, controller::dismissError)
}

@Composable
private fun SessionRow(session: SessionSummary, onClick: () -> Unit) {
    val isRunning = session.status == "running"
    Surface(
        onClick = onClick, tonalElevation = 1.dp,
        shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(46.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(15.dp)),
                contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Code, null, tint = MaterialTheme.colorScheme.primary)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(session.title, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                Text(session.workspace.substringAfterLast('\\').substringAfterLast('/').ifBlank { "Sin carpeta" },
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(5.dp))
                Text("${session.turnCount} turnos · ${session.model.ifBlank { "Muse" }}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.width(8.dp))
            if (isRunning) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            } else Icon(Icons.Default.ChevronRight, null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ConversationScene(state: MuseState, controller: MuseController) {
    var input by remember(state.sessionId) { mutableStateOf("") }
    val list = rememberLazyListState()

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = controller::backToSessions) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Volver a sesiones")
            }
            Column(Modifier.weight(1f)) {
                Text(state.sessionTitle, style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(state.workspace.substringAfterLast('\\').substringAfterLast('/').ifBlank { "Sin carpeta" },
                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1)
            }
            StreamChip(state.stream)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.22f))
        val count = state.items.size + (if (state.working) 1 else 0)
        LaunchedEffect(state.items.size, state.items.lastOrNull()?.text?.length, state.working) {
            val nearBottom = list.layoutInfo.visibleItemsInfo.lastOrNull()?.index
                ?.let { it >= (count - 3).coerceAtLeast(0) } ?: true
            if (nearBottom && count > 0) list.animateScrollToItem(count - 1)
        }
        LazyColumn(
            state = list, modifier = Modifier.weight(1f).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 16.dp),
        ) {
            items(state.items, key = { it.id }) { item ->
                ChatRow(item)
            }
            if (state.working) item(key = "work-indicator") {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text("Muse está trabajando…", style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (state.approvals.isNotEmpty() || state.questions.isNotEmpty()) {
            Column(Modifier.fillMaxWidth().heightIn(max = 280.dp).verticalScroll(rememberScrollState())
                .padding(horizontal = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                state.approvals.forEach { approval ->
                    ApprovalCard(approval) { controller.decide(approval, it) }
                }
                state.questions.forEach { question ->
                    QuestionCard(question) { controller.answer(question, it) }
                }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.22f))
        Row(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 12.dp),
            verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text(if (state.working) "Enviar a la cola…" else "Escribe a Muse…") },
                maxLines = 5, minLines = 1,
                shape = RoundedCornerShape(20.dp),
                keyboardOptions = KeyboardOptions.Default,
            )
            if (state.working) {
                IconButton(onClick = controller::interrupt, modifier = Modifier.size(50.dp)) {
                    Icon(Icons.Default.StopCircle, contentDescription = "Detener turno")
                }
            }
            FilledIconButton(
                onClick = { val t = input; input = ""; controller.send(t) },
                enabled = input.isNotBlank() && !state.sending,
                modifier = Modifier.size(50.dp), shape = RoundedCornerShape(16.dp),
            ) {
                if (state.sending) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Enviar mensaje")
            }
        }
    }
    ErrorPopup(state.error, controller::dismissError)
}

@Composable
private fun ChatRow(item: ChatItem) {
    val user = item.kind == "userMessage"
    val technical = item.kind in setOf("reasoning", "toolCall", "userShell", "subagent", "workflow")
    var expanded by remember(item.id) { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (user) Alignment.End else Alignment.Start,
    ) {
        if (technical) {
            Surface(
                onClick = { expanded = !expanded },
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Terminal, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(10.dp))
                        Text(item.toolName.ifBlank {
                            when (item.kind) {
                                "reasoning" -> "Razonamiento"
                                "subagent" -> "Subagente"
                                "workflow" -> "Workflow"
                                else -> "Herramienta"
                            }
                        }, modifier = Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
                        if (item.status.isNotBlank()) Text(item.status,
                            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.width(6.dp))
                        Icon(if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null)
                    }
                    if (expanded) {
                        Spacer(Modifier.height(12.dp))
                        Text((item.detail + "\n" + item.text).trim().ifBlank { "Sin detalles adicionales." },
                            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace))
                    }
                }
            }
        } else {
            Surface(
                color = if (user) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
                contentColor = if (user) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier.fillMaxWidth(if (user) 0.9f else 1f),
            ) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 13.dp)) {
                    Text(if (user) "Tú" else "Muse", style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(6.dp))
                    Text(item.text.ifBlank { "…" }, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

@Composable
private fun ApprovalCard(a: PendingApproval, onChoice: (String) -> Unit) {
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.GppMaybe, null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(8.dp))
            Text("Aprobación requerida", fontWeight = FontWeight.Bold)
        }
        Text(a.title, style = MaterialTheme.typography.titleSmall)
        if (a.detail.isNotEmpty()) Text(a.detail, style = MaterialTheme.typography.bodySmall,
            fontFamily = FontFamily.Monospace, maxLines = 5, overflow = TextOverflow.Ellipsis)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            a.choices.forEach { choice ->
                OutlinedButton(onClick = { onChoice(choice.id) }, modifier = Modifier.weight(1f)) {
                    Text(choice.label, maxLines = 2)
                }
            }
        }
    }
}

@Composable
private fun QuestionCard(q: PromptQuestion, onAnswer: (String) -> Unit) {
    var response by remember(q.id) { mutableStateOf("") }
    SectionCard {
        Text("Muse pregunta", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
        Text(q.title)
        q.options.forEach { option ->
            OutlinedButton(onClick = { onAnswer(option) }, modifier = Modifier.fillMaxWidth()) {
                Text(option)
            }
        }
        OutlinedTextField(
            value = response, onValueChange = { response = it },
            placeholder = { Text("O escribe tu respuesta") }, modifier = Modifier.fillMaxWidth(),
        )
        TextButton(onClick = { onAnswer(response) }, enabled = response.isNotBlank()) {
            Text("Responder")
        }
    }
}

@Composable
private fun StreamChip(value: String) {
    val good = value == "En vivo"
    Surface(
        shape = RoundedCornerShape(50),
        color = if (good) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(7.dp).background(if (good) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.outline, RoundedCornerShape(50)))
            Spacer(Modifier.width(6.dp))
            Text(value, style = MaterialTheme.typography.labelSmall, maxLines = 1)
        }
    }
}

@Composable
private fun SectionCard(content: @Composable ColumnScope.() -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(24.dp),
        tonalElevation = 1.dp,
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp), content = content)
    }
}

@Composable
private fun ErrorNotice(message: String?, onDismiss: () -> Unit) {
    if (message.isNullOrBlank()) return
    Spacer(Modifier.height(12.dp))
    Surface(color = MaterialTheme.colorScheme.errorContainer,
        shape = RoundedCornerShape(14.dp)) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(message, color = MaterialTheme.colorScheme.onErrorContainer,
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
            IconButton(onClick = onDismiss) { Icon(Icons.Default.Close, "Cerrar error") }
        }
    }
}

@Composable
private fun ErrorPopup(message: String?, onDismiss: () -> Unit) {
    if (!message.isNullOrEmpty()) AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("No se pudo completar la operación") },
        text = { Text(message) },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Entendido") } },
    )
}
