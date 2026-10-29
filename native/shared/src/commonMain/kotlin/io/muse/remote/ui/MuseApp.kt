package io.muse.remote.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.interaction.collectIsDraggedAsState
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import io.muse.remote.core.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val Forest = Color(0xFF16754B)
private val Mint = Color(0xFF55D797)
private val Dark = Color(0xFF0E1713)
private val Panel = Color(0xFF18251E)
private val Light = Color(0xFFF4F7F3)
private val Ink = Color(0xFF15261D)

/** UI-only thumbnail stays in memory. Bytes are sent only on explicit confirmation. */
data class PickedAttachment(
    val data: ComposerAttachment,
    val preview: ImageBitmap? = null,
)


@Composable
fun MuseApp(
    controller: MuseController,
    discovery: LanDiscovery = EmptyLanDiscovery,
    scanPair: (() -> Unit)? = null,
    pickImage: (((PickedAttachment) -> Unit) -> Unit)? = null,
    pickDocument: (((PickedAttachment) -> Unit) -> Unit)? = null,
    brandArtwork: (@Composable () -> Unit)? = null,
    notificationsEnabled: Boolean = false,
    onNotificationsChange: ((Boolean) -> Unit)? = null,
) {
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
                    Screen.Login -> LoginScene(state, controller, discovery, scanPair, brandArtwork)
                    Screen.Sessions -> SessionScene(state, controller, brandArtwork, notificationsEnabled, onNotificationsChange)
                    Screen.Conversation -> ConversationScene(
                        state, controller, pickImage, pickDocument,
                    )
                }
            }
        }
    }
}

@Composable
private fun LoginScene(
    state: MuseState,
    controller: MuseController,
    discovery: LanDiscovery,
    scanPair: (() -> Unit)?,
    brandArtwork: (@Composable () -> Unit)?,
) {
    var endpoint by remember(state.endpoint) { mutableStateOf(state.endpoint) }
    var token by remember { mutableStateOf("") }
    var showToken by remember { mutableStateOf(false) }
    var pin by remember { mutableStateOf("") }
    var fallback by remember { mutableStateOf("") }
    var advanced by remember { mutableStateOf(false) }
    val nearby by discovery.services.collectAsState()

    if (state.restoringConnection) {
        Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                CircularProgressIndicator()
                Text("Reconectando con tu PC…", style = MaterialTheme.typography.titleLarge)
                Text("Utilizando el acceso cifrado que ya tienes guardado",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        return
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.size(68.dp).background(MaterialTheme.colorScheme.primary, RoundedCornerShape(22.dp)),
            contentAlignment = Alignment.Center,
        ) {
            if (brandArtwork != null) brandArtwork()
            else Icon(Icons.Default.Terminal, contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(34.dp))
        }
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
            if (state.savedConnectionAvailable) {
                FilledTonalButton(
                    onClick = controller::retrySavedConnection,
                    enabled = !state.loading,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Icon(Icons.Default.Refresh, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Reconectar con el acceso guardado")
                }
                Spacer(Modifier.height(8.dp))
                Text("El token sigue cifrado en este dispositivo; no hace falta escanear otro QR.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(14.dp))
            }
            if (scanPair != null) {
                FilledTonalButton(
                    onClick = scanPair, modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Icon(Icons.Default.QrCodeScanner, null, Modifier.size(20.dp))
                    Spacer(Modifier.width(10.dp))
                    Text("Emparejar con QR de mi PC")
                }
                Spacer(Modifier.height(8.dp))
                Text("Configuración automática y conexión HTTPS verificada",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(14.dp))
            }
            if (nearby.isNotEmpty()) {
                Text("PC encontradas en esta red", style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary)
                nearby.forEach { pc ->
                    TextButton(onClick = { endpoint = pc.url }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.Computer, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(pc.name, maxLines = 1, modifier = Modifier.weight(1f))
                        Icon(Icons.Default.ChevronRight, null, Modifier.size(17.dp))
                    }
                }
                Text("Para una PC nueva, escanea su QR o introduce su huella TLS.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(12.dp))
            }
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
            Spacer(Modifier.height(12.dp))
            TextButton(onClick = { advanced = !advanced }) {
                Icon(if (advanced) Icons.Default.ExpandLess else Icons.Default.Tune, null)
                Spacer(Modifier.width(6.dp))
                Text(if (advanced) "Ocultar opciones de conexión" else "Opciones de conexión segura")
            }
            if (advanced) {
                OutlinedTextField(
                    value = pin,
                    onValueChange = { pin = it.replace(":", "").replace(" ", "").take(64) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Huella SHA-256 LAN (para certificado autofirmado)") },
                    placeholder = { Text("64 caracteres hexadecimales") },
                    singleLine = true,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = fallback, onValueChange = { fallback = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("URL HTTPS Tailscale de respaldo (opcional)") },
                    placeholder = { Text("https://pc.tailnet.ts.net") },
                    singleLine = true,
                )
            }
            Spacer(Modifier.height(18.dp))
            Button(
                enabled = !state.loading && endpoint.isNotBlank() && token.isNotBlank(),
                onClick = { controller.connect(endpoint, token, pin.ifBlank { null },
                    fallback.ifBlank { null }) },
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
            "Para conectarte por Wi-Fi utiliza el QR del PC: verifica su certificado antes de enviar el token. Fuera de casa puedes usar HTTPS de Tailscale.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        ErrorNotice(state.error, controller::dismissError)
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun SessionScene(
    state: MuseState,
    controller: MuseController,
    brandArtwork: (@Composable () -> Unit)? = null,
    notificationsEnabled: Boolean = false,
    onNotificationsChange: ((Boolean) -> Unit)? = null,
) {
    var search by remember { mutableStateOf("") }
    var createDialog by remember { mutableStateOf(false) }
    var showHidden by remember { mutableStateOf(false) }
    var projectFilter by remember { mutableStateOf("all") }
    var createProjectDialog by remember { mutableStateOf(false) }
    var manageProjects by remember { mutableStateOf(false) }
    var contributorDialog by remember { mutableStateOf(false) }
    var organizerSyncDialog by remember { mutableStateOf(false) }
    if (organizerSyncDialog) OrganizerSyncDialog(state, controller,
        onDismiss = { organizerSyncDialog = false })
    var globalSearchDialog by remember { mutableStateOf(false) }
    if (globalSearchDialog) GlobalSearchDialog(state, controller,
        onDismiss = { globalSearchDialog = false })

    LaunchedEffect(state.projects) {
        if (projectFilter !in setOf("all", "pinned", "unassigned") &&
            state.projects.none { it.id == projectFilter }) projectFilter = "all"
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically) {
            if (brandArtwork != null) {
                Box(Modifier.size(34.dp), contentAlignment = Alignment.Center) { brandArtwork() }
                Spacer(Modifier.width(9.dp))
            }
            Column(Modifier.weight(1f)) {
                Text("Muse Remote", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Estación conectada", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
            }
            IconButton(onClick = {
                controller.refreshContributor()
                contributorDialog = true
            }) {
                Icon(Icons.Default.Settings, contentDescription = "Ajustes de Contributor")
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
                    Text(if (state.sessionsLoading && !state.sessionsLoaded &&
                        state.sessionsPageCount == 0) "Sincronizando conversaciones…"
                        else "${state.sessions.count { it.id !in state.hiddenSessionIds }} conversaciones visibles",
                        style = MaterialTheme.typography.bodySmall,
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
            TextButton(onClick = {
                controller.refreshContributor()
                contributorDialog = true
            }) {
                Icon(Icons.Default.Settings, null, Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text("Modo Contributor · ajustes de la PC")
            }
            if (state.organizerSyncAvailable) {
                TextButton(onClick = { organizerSyncDialog = true }) {
                    Icon(Icons.Default.Sync, null, Modifier.size(17.dp))
                    Spacer(Modifier.width(7.dp))
                    Text("Sincronización cifrada · proyectos y chats")
                }
            }
            if (onNotificationsChange != null) {
                Row(Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Avisos de aprobación y finalización",
                            style = MaterialTheme.typography.bodyMedium)
                        Text("Solo mientras la app siga activa en memoria",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Switch(
                        checked = notificationsEnabled,
                        onCheckedChange = onNotificationsChange,
                    )
                }
            }
            Spacer(Modifier.height(4.dp))
            OutlinedTextField(
                value = search, onValueChange = { search = it },
                placeholder = { Text("Buscar por nombre o carpeta") },
                leadingIcon = { Icon(Icons.Default.Search, null) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                shape = RoundedCornerShape(18.dp),
            )
            TextButton(onClick = { globalSearchDialog = true },
                enabled = state.authenticated && state.sessions.isNotEmpty()) {
                Icon(Icons.Default.Search, contentDescription = null,
                    modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(7.dp))
                Text("Buscar dentro de conversaciones")
            }
            Spacer(Modifier.height(4.dp))
            ProjectFilterStrip(state, projectFilter, { projectFilter = it },
                { createProjectDialog = true }, { manageProjects = true })
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                FilterChip(selected = !showHidden, onClick = { showHidden = false },
                    label = { Text("Sesiones") })
                FilterChip(selected = showHidden, onClick = { showHidden = true },
                    label = { Text("Ocultas (${state.hiddenSessionIds.size})") })
            }
            if (showHidden) {
                Text("Ocultas solo en este dispositivo. Siguen guardadas en Muse.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(10.dp))
            val shown = remember(state.sessions, search, state.hiddenSessionIds,
                showHidden, state.pinnedSessionIds, state.projectAssignments, state.sessionAliases, projectFilter) {
                state.sessions.filter {
                    val inScope = when (projectFilter) {
                        "all" -> true
                        "pinned" -> it.id in state.pinnedSessionIds
                        "unassigned" -> state.projectAssignments[it.id] == null
                        else -> state.projectAssignments[it.id] == projectFilter
                    }
                    (it.id in state.hiddenSessionIds) == showHidden && inScope &&
                        ((state.sessionAliases[it.id] ?: it.title).contains(search, true) ||
                            it.title.contains(search, true) || it.workspace.contains(search, true))
                }.sortedWith(compareByDescending<SessionSummary> {
                    it.id in state.pinnedSessionIds
                }.thenByDescending { it.updatedAt })
                    .map { it.copy(title = state.sessionAliases[it.id] ?: it.title) }
            }
            if (state.sessionsLoading) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                Text(if (state.sessionsPageCount > 0)
                    "Sincronizando… ${state.sessionsPageCount} páginas recibidas"
                    else "Consultando a Muse en la PC… Al reiniciar puede tardar unos minutos.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(8.dp))
            }
            if (state.sessionsError != null) {
                Text(state.sessionsError, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error)
                TextButton(onClick = controller::refreshSessions) {
                    Icon(Icons.Default.Refresh, null)
                    Spacer(Modifier.width(7.dp))
                    Text("Reintentar listado")
                }
            }
            if (shown.isEmpty() && state.sessionsLoading && !state.sessionsLoaded) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else if (shown.isEmpty() && state.sessionsError != null) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("No se pudo cargar el historial de Muse.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else if (shown.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(32.dp)) {
                        Icon(Icons.Default.FolderOpen, null, modifier = Modifier.size(46.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(14.dp))
                        Text(if (search.isNotBlank()) "Sin resultados" else if (showHidden)
                            "No hay sesiones ocultas" else "No hay sesiones visibles",
                            style = MaterialTheme.typography.titleMedium)
                        Text(if (search.isNotBlank()) "Prueba con otro término."
                            else if (showHidden) "Las sesiones que ocultes aparecerán aquí."
                            else "Muse no devolvió sesiones. Compruébalas en la PC o pulsa Actualizar.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            } else {
                LazyColumn(contentPadding = PaddingValues(bottom = 26.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(shown, key = { it.id }) { session ->
                        SessionRow(
                            session = session,
                            originalTitle = state.sessions.firstOrNull { it.id == session.id }?.title
                                ?: session.title,
                            alias = state.sessionAliases[session.id],
                            onRename = { value ->
                                if (value == null) controller.restoreSessionName(session.id)
                                else controller.renameSessionLocally(session.id, value)
                            },
                            hidden = showHidden,
                            pinned = session.id in state.pinnedSessionIds,
                            project = state.projects.firstOrNull {
                                it.id == state.projectAssignments[session.id] },
                            projects = state.projects,
                            onPin = { controller.togglePinned(session.id) },
                            onMove = { controller.assignSession(session.id, it) },
                            onClick = { controller.openSession(session.id) },
                            onHideOrRestore = {
                                if (showHidden) controller.restoreSession(session.id)
                                else controller.hideSession(session.id)
                            },
                        )
                    }
                }
            }
        }
    }
    if (contributorDialog) ContributorSettingsDialog(state, controller,
        onDismiss = { contributorDialog = false })
    if (createProjectDialog) ProjectEditor(
        project = null, onDismiss = { createProjectDialog = false },
        onSave = { name, workspace ->
            controller.createProject(name, workspace)
            createProjectDialog = false
        })
    if (manageProjects) ProjectManager(state, controller, onDismiss = { manageProjects = false })
    if (createDialog) {
        var workspace by remember { mutableStateOf("") }
        var projectId by remember {
            mutableStateOf<String?>(state.projects.firstOrNull { it.id == projectFilter }?.id)
        }

        AlertDialog(
            onDismissRequest = { createDialog = false },
            title = { Text("Nueva sesión") },
            text = {
                Column {
                    Text("Indica la carpeta de trabajo de tu PC. Déjala vacía para una sesión sin carpeta.")
                    Spacer(Modifier.height(12.dp))
                    Text("Agregar al proyecto", style = MaterialTheme.typography.labelMedium)
                    ProjectPicker(state.projects, projectId, { chosen ->
                        projectId = chosen
                        val project = state.projects.firstOrNull { it.id == chosen }
                        if (project != null && workspace.isBlank()) workspace = project.workspace
                    })
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
                TextButton(onClick = {
                    createDialog = false
                    val project = state.projects.firstOrNull { it.id == projectId }
                    controller.createSession(workspace.ifBlank { project?.workspace.orEmpty() }, projectId)
                }) { Text("Crear") }
            },
            dismissButton = { TextButton(onClick = { createDialog = false }) { Text("Cancelar") } },
        )
    }
    ErrorPopup(state.error, controller::dismissError)
}

@Composable
private fun SessionRow(
    session: SessionSummary,
    originalTitle: String,
    alias: String?,
    onRename: (String?) -> Unit,
    hidden: Boolean,
    pinned: Boolean,
    project: RemoteProject?,
    projects: List<RemoteProject>,
    onPin: () -> Unit,
    onMove: (String?) -> Unit,
    onClick: () -> Unit,
    onHideOrRestore: () -> Unit,
) {
    val isRunning = session.status == "running"
    var menuExpanded by remember(session.id) { mutableStateOf(false) }
    var moveDialog by remember(session.id) { mutableStateOf(false) }
    var renameDialog by remember(session.id) { mutableStateOf(false) }
    if (renameDialog) RenameSessionDialog(
        originalTitle = originalTitle, alias = alias,
        onSave = { onRename(it) }, onReset = { onRename(null) },
        onDismiss = { renameDialog = false },
    )
    if (moveDialog) {
        var assignment by remember(session.id) { mutableStateOf(project?.id) }
        AlertDialog(onDismissRequest = { moveDialog = false },
            title = { Text("Mover a proyecto") },
            text = {
                Column {
                    Text(session.title, maxLines = 2)
                    Spacer(Modifier.height(12.dp))
                    ProjectPicker(projects, assignment, { assignment = it })
                }
            },
            confirmButton = { TextButton(onClick = {
                onMove(assignment)
                moveDialog = false
            }) { Text("Guardar") } },
            dismissButton = { TextButton(onClick = { moveDialog = false }) { Text("Cancelar") } })
    }
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
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (pinned) {
                        Icon(Icons.Default.PushPin, contentDescription = "Chat fijado",
                            modifier = Modifier.size(15.dp), tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(5.dp))
                    }
                    Text(session.title, maxLines = 2, overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold)
                }
                if (project != null) {
                    Text(project.name, style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary, maxLines = 1)
                }
                Spacer(Modifier.height(4.dp))
                Text(session.workspace.substringAfterLast('\\').substringAfterLast('/').ifBlank { "Sin carpeta" },
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(5.dp))
                Text("${session.turnCount} turnos · ${session.model.ifBlank { "Muse" }}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.width(4.dp))
            Box {
                IconButton(onClick = { menuExpanded = true }) {
                    Icon(Icons.Default.MoreVert, contentDescription = "Opciones de sesión")
                }
                DropdownMenu(expanded = menuExpanded,
                    onDismissRequest = { menuExpanded = false }) {
                    DropdownMenuItem(
                        text = { Text("Renombrar chat") },
                        leadingIcon = { Icon(Icons.Default.Edit, null) },
                        onClick = { menuExpanded = false; renameDialog = true },
                    )
                    DropdownMenuItem(
                        text = { Text(if (pinned) "Desfijar chat" else "Fijar arriba") },
                        leadingIcon = { Icon(Icons.Default.PushPin, null) },
                        onClick = { menuExpanded = false; onPin() },
                    )
                    DropdownMenuItem(
                        text = { Text("Mover a proyecto") },
                        leadingIcon = { Icon(Icons.Default.Folder, null) },
                        onClick = { menuExpanded = false; moveDialog = true },
                    )
                    DropdownMenuItem(
                        text = { Text(if (hidden) "Restaurar a la lista" else "Ocultar en este dispositivo") },
                        leadingIcon = {
                            Icon(if (hidden) Icons.Default.Unarchive else Icons.Default.Archive, null)
                        },
                        onClick = {
                            menuExpanded = false
                            onHideOrRestore()
                        },
                    )
                }
            }
            if (isRunning) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            } else Icon(Icons.Default.ChevronRight, null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ConversationScene(
    state: MuseState,
    controller: MuseController,
    pickImage: (((PickedAttachment) -> Unit) -> Unit)?,
    pickDocument: (((PickedAttachment) -> Unit) -> Unit)?,
) {
    var input by remember(state.sessionId) {
        mutableStateOf(controller.draftFor(state.sessionId))
    }
    val currentDraft by rememberUpdatedState(input)
    DisposableEffect(state.sessionId) {
        val draftSessionId = state.sessionId
        onDispose { controller.saveDraft(draftSessionId, currentDraft) }
    }
    LaunchedEffect(state.sessionId, input) {
        delay(400)
        controller.saveDraft(state.sessionId, input)
    }
    var attachment by remember(state.sessionId) { mutableStateOf<PickedAttachment?>(null) }
    var attachmentMenu by remember { mutableStateOf(false) }
    var showTools by remember(state.sessionId) { mutableStateOf(false) }
    var showWorkflows by remember(state.sessionId) { mutableStateOf(false) }
    var showSearch by remember(state.sessionId) { mutableStateOf(false) }
    var searchInChat by remember(state.sessionId) { mutableStateOf("") }
    var showRename by remember(state.sessionId) { mutableStateOf(false) }
    var sendAsSteer by remember(state.sessionId) { mutableStateOf(false) }
    LaunchedEffect(state.turnId, state.working, attachment) {
        if (state.turnId == null || !state.working || attachment != null) sendAsSteer = false
    }
    var pendingSend by remember(state.sessionId) { mutableStateOf(false) }
    // Discard the draft ONLY after the backend acknowledges turn/start.
    // On failure, preserve both text and attached bytes for manual retry.
    LaunchedEffect(state.sending, state.error) {
        if (pendingSend && !state.sending) {
            if (state.error == null) {
                input = ""
                controller.saveDraft(state.sessionId, "")
                attachment = null
            }
            pendingSend = false
        }
    }
    val list = rememberLazyListState()
    val scrollScope = rememberCoroutineScope()
    val allEntries = remember(state.items) { conversationEntries(state.items) }
    val entries = remember(allEntries, searchInChat) {
        if (searchInChat.isBlank()) allEntries else allEntries.filter { entry ->
            when (entry) {
                is ConversationEntry.Message -> entry.item.text.contains(searchInChat, true)
                is ConversationEntry.Activity -> entry.steps.any { step ->
                    step.text.contains(searchInChat, true) ||
                        step.toolName.contains(searchInChat, true)
                }
            }
        }
    }
    // A new conversation should always start at the latest message.
    // Disable following only when the person intentionally drags the list
    // away from its tail. New incoming events must not steal their scroll.
    var followTail by remember(state.sessionId) { mutableStateOf(true) }
    val dragging by list.interactionSource.collectIsDraggedAsState()
    val nearTail by remember(list) {
        derivedStateOf {
            val layout = list.layoutInfo
            layout.totalItemsCount == 0 ||
                (layout.visibleItemsInfo.lastOrNull()?.index ?: -1) >=
                    (layout.totalItemsCount - 2).coerceAtLeast(0)
        }
    }
    LaunchedEffect(dragging, nearTail) {
        if (dragging) followTail = nearTail
        else if (nearTail) followTail = true
    }

    if (showRename) RenameSessionDialog(
        originalTitle = state.sessionTitle,
        alias = state.sessionId?.let { state.sessionAliases[it] },
        onSave = { name -> state.sessionId?.let { controller.renameSessionLocally(it, name) } },
        onReset = { state.sessionId?.let(controller::restoreSessionName) },
        onDismiss = { showRename = false },
    )
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = controller::backToSessions) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Volver a sesiones")
            }
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(state.sessionId?.let { state.sessionAliases[it] } ?: state.sessionTitle,
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold, maxLines = 1,
                        overflow = TextOverflow.Ellipsis)
                    IconButton(onClick = { showRename = true }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Default.Edit, contentDescription = "Renombrar chat",
                            modifier = Modifier.size(17.dp))
                    }
                }
                Text(state.workspace.substringAfterLast('\\').substringAfterLast('/').ifBlank { "Sin carpeta" },
                    style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1)
            }
            StreamChip(state.stream)
            IconButton(onClick = {
                showSearch = !showSearch
                if (!showSearch) searchInChat = ""
                else followTail = false
            }) {
                Icon(Icons.Default.Search, contentDescription = "Buscar en conversación")
            }
            if (state.sessionReady) IconButton(onClick = {
                controller.refreshSessionTools()
                controller.refreshProductivity()
                showWorkflows = true
            }) {
                Icon(Icons.Default.SpaceDashboard,
                    contentDescription = "Centro de trabajo")
            }
            if (state.sessionReady) IconButton(onClick = {
                controller.refreshSessionTools()
                showTools = true
            }) {
                Icon(Icons.Default.Tune, contentDescription = "Herramientas de la sesión")
            }
        }
        if (showSearch) {
            OutlinedTextField(
                value = searchInChat,
                onValueChange = { searchInChat = it.take(120); followTail = false },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                label = { Text("Buscar dentro de este chat") },
                leadingIcon = { Icon(Icons.Default.Search, null) },
                trailingIcon = { IconButton(onClick = {
                    searchInChat = ""; showSearch = false; followTail = true
                }) { Icon(Icons.Default.Close, contentDescription = "Cerrar búsqueda") } },
                singleLine = true,
            )
            Text("${entries.size} resultados cargados", Modifier.padding(horizontal = 14.dp),
                style = MaterialTheme.typography.labelSmall)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.22f))
        if (state.sessionReady) {
            ModelSettingsBar(state, controller)
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.14f))
        }
        var waitingSeconds by remember(state.sessionId) { mutableIntStateOf(0) }
        LaunchedEffect(state.sessionId, state.loading) {
            waitingSeconds = 0
            while (state.loading) {
                delay(1_000L)
                waitingSeconds++
            }
        }
        if (state.loading && !state.sessionReady) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                LinearProgressIndicator(Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                Text(state.stream, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Esperando ${waitingSeconds} s · Muse puede tardar al cargar sesiones antiguas.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (waitingSeconds >= 25) {
                    Text("Puedes volver a la lista sin perder tus sesiones.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        } else if (!state.sessionReady) {
            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                Text(if (state.sessionBusyElsewhere) "Abierta en Terminal"
                    else "Esta sesión todavía no está activa",
                    fontWeight = FontWeight.SemiBold)
                Text(if (state.sessionBusyElsewhere)
                    "Muse está utilizando esta conversación en la PC. Puedes leerla aquí. Para enviar mensajes desde el móvil, ciérrala en Terminal y pulsa Reintentar."
                    else "Puedes leer el historial si está disponible. Para enviar mensajes, reanúdala.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = { state.sessionId?.let(controller::openSession) }) {
                    Icon(Icons.Default.Refresh, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Reintentar conexión")
                }
            }
        }
        val count = entries.size + (if (state.working) 1 else 0)
        val latestTextLength = (entries.lastOrNull { it is ConversationEntry.Message }
            as? ConversationEntry.Message)?.item?.text?.length
        LaunchedEffect(state.sessionId, entries.size, latestTextLength,
            state.working, followTail) {
            if (followTail && count > 0 && !dragging) {
                // scrollToItem snaps even for multi-hundred item transcripts.
                // animateScrollToItem from index 0 is too slow and is cancelled
                // repeatedly by incoming history/streaming updates.
                list.scrollToItem(count - 1)
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(
                state = list, modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 16.dp),
            ) {
                items(entries, key = { it.key }) { entry ->
                    when (entry) {
                        is ConversationEntry.Message -> ChatRow(entry.item)
                        is ConversationEntry.Activity -> ActivityRow(
                            entry, state.working && entry.key ==
                                entries.lastOrNull { it is ConversationEntry.Activity }?.key,
                        )
                    }
                }
                if (state.working) item(key = "work-indicator") {
                    Row(Modifier.fillMaxWidth().padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(10.dp))
                        Text("Muse está trabajando…", style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            if (!nearTail && count > 0) {
                FilledTonalButton(
                    onClick = {
                        followTail = true
                        scrollScope.launch { list.scrollToItem(count - 1) }
                    },
                    modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
                    shape = RoundedCornerShape(50),
                ) {
                    Icon(Icons.Default.KeyboardArrowDown, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text("Último mensaje")
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
        if (state.working && state.sessionReady) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 3.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FilterChip(selected = !sendAsSteer, onClick = { sendAsSteer = false },
                    label = { Text("Enviar a la cola") })
                FilterChip(selected = sendAsSteer, onClick = { sendAsSteer = true },
                    enabled = state.turnId != null && attachment == null,
                    label = { Text("Dirigir turno actual") })
            }
        }
        if (attachment != null) {
            val picked = attachment!!
            Surface(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = RoundedCornerShape(16.dp),
            ) {
                Row(
                    Modifier.padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (picked.preview != null) {
                        Image(
                            picked.preview, contentDescription = "Vista previa de la imagen",
                            modifier = Modifier.size(52.dp),
                            contentScale = ContentScale.Crop,
                        )
                    } else {
                        Icon(Icons.Default.InsertDriveFile, contentDescription = null)
                    }
                    Column(Modifier.weight(1f)) {
                        Text(picked.data.name, maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.labelLarge)
                        Text(
                            if (picked.data is ComposerAttachment.Photo)
                                "Imagen · se enviará a Muse"
                            else "Archivo · se copiará de forma segura a tu PC",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = { attachment = null }, enabled = !state.sending) {
                        Icon(Icons.Default.Close, contentDescription = "Quitar adjunto")
                    }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 12.dp),
            verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (pickImage != null || pickDocument != null) {
                Box {
                    IconButton(onClick = { attachmentMenu = true },
                        enabled = state.sessionReady && !state.sending) {
                        Icon(Icons.Default.AddCircleOutline,
                            contentDescription = "Adjuntar imagen o archivo")
                    }
                    DropdownMenu(expanded = attachmentMenu, onDismissRequest = {
                        attachmentMenu = false
                    }) {
                        if (pickImage != null) DropdownMenuItem(
                            text = { Text("Foto o imagen") },
                            leadingIcon = { Icon(Icons.Default.Image, null) },
                            onClick = {
                                attachmentMenu = false
                                pickImage { attachment = it }
                            },
                        )
                        if (pickDocument != null) DropdownMenuItem(
                            text = { Text("Archivo de la PC") },
                            leadingIcon = { Icon(Icons.Default.AttachFile, null) },
                            onClick = {
                                attachmentMenu = false
                                pickDocument { attachment = it }
                            },
                        )
                    }
                }
            }
            OutlinedTextField(
                value = input,
                onValueChange = { input = it.take(20000) },
                modifier = Modifier.weight(1f),
                placeholder = { Text(if (state.working && sendAsSteer) "Instrucción para el turno activo…"
                    else if (state.working) "Enviar a la cola…" else "Escribí a Muse…") },
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
                onClick = {
                    followTail = true
                    pendingSend = true
                    if (state.working && sendAsSteer && state.turnId != null &&
                        attachment == null) controller.steer(input)
                    else controller.send(input, attachment?.data)
                    scrollScope.launch {
                        if (count > 0) list.scrollToItem(count - 1)
                    }
                },
                enabled = state.sessionReady && (input.isNotBlank() || attachment != null) &&
                    !state.sending,
                modifier = Modifier.size(50.dp), shape = RoundedCornerShape(16.dp),
            ) {
                if (state.sending) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Enviar mensaje")
            }
        }
    }
    if (showWorkflows) WorkflowPanel(state, controller,
        onDismiss = { showWorkflows = false })
    if (showTools) SessionToolsDialog(state, controller, onDismiss = { showTools = false })
    ErrorPopup(state.error, controller::dismissError)
}

@Composable
private fun ActivityRow(activity: ConversationEntry.Activity, isCurrent: Boolean) {
    var expanded by remember(activity.key) { mutableStateOf(false) }
    var visibleCount by remember(activity.key) { mutableIntStateOf(8) }
    var openedStep by remember(activity.key) { mutableStateOf<String?>(null) }
    val failed = activity.failedCount
    val count = activity.steps.size
    val working = isCurrent && activity.steps.any {
        it.status.lowercase() in setOf("running", "inprogress", "in_progress", "pending")
    }

    Surface(
        onClick = { expanded = !expanded },
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.18f)),
    ) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 11.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Terminal, contentDescription = null,
                    modifier = Modifier.size(17.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        "Actividad de Muse",
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        buildString {
                            append(count)
                            append(if (count == 1) " paso" else " pasos")
                            if (activity.reasoningCount > 0) {
                                append(" · ")
                                append(activity.reasoningCount)
                                append(" de razonamiento")
                            }
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (working) {
                    CircularProgressIndicator(
                        Modifier.size(14.dp), strokeWidth = 2.dp,
                    )
                    Spacer(Modifier.width(8.dp))
                }
                if (failed > 0) {
                    Icon(Icons.Default.ErrorOutline, contentDescription = "$failed pasos con errores",
                        modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(5.dp))
                    Text("$failed", style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.width(9.dp))
                }
                Icon(if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = if (expanded) "Ocultar actividad" else "Mostrar actividad",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (expanded) {
                Spacer(Modifier.height(12.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.16f))
                Spacer(Modifier.height(4.dp))
                val recent = activity.steps.takeLast(visibleCount)
                if (activity.steps.size > visibleCount) {
                    TextButton(
                        onClick = { visibleCount += 16 },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Mostrar ${minOf(16, count - visibleCount)} pasos anteriores")
                    }
                }
                recent.forEach { step ->
                    val showDetails = openedStep == step.id
                    val details = (step.detail + "\n" + step.text).trim()
                    val canExpand = details.isNotBlank() &&
                        details != "..." && details != "…"
                    Column {
                        Row(
                            Modifier.fillMaxWidth().clickable(enabled = canExpand) {
                                openedStep = if (showDetails) null else step.id
                            }.padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            val failedStep = step.status.lowercase() in
                                setOf("failed", "error", "rejected")
                            Icon(
                                if (failedStep) Icons.Default.ErrorOutline else
                                    if (step.status == "completed") Icons.Default.CheckCircleOutline
                                    else Icons.Default.RadioButtonUnchecked,
                                contentDescription = null,
                                modifier = Modifier.size(15.dp),
                                tint = if (failedStep) MaterialTheme.colorScheme.error
                                    else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.width(9.dp))
                            Text(
                                step.toolName.ifBlank {
                                    when (step.kind) {
                                        "reasoning" -> "Razonamiento"
                                        "userShell" -> "Comando"
                                        "subagent" -> "Subagente"
                                        "workflow" -> "Flujo de trabajo"
                                        "toolCall" -> "Herramienta"
                                        else -> "Paso de Muse"
                                    }
                                },
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.weight(1f),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (canExpand) Icon(
                                if (showDetails) Icons.Default.ExpandLess else Icons.Default.ChevronRight,
                                contentDescription = if (showDetails) "Ocultar detalle" else "Ver detalle",
                                modifier = Modifier.size(16.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (showDetails && canExpand) {
                            Text(
                                details,
                                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.fillMaxWidth().padding(start = 24.dp, bottom = 10.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatRow(item: ChatItem) {
    val user = item.kind == "userMessage"
    Column(
        Modifier.fillMaxWidth(),
        horizontalAlignment = if (user) Alignment.End else Alignment.Start,
    ) {
        Surface(
            color = if (user) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface,
            contentColor = if (user) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
            shape = RoundedCornerShape(20.dp),
            modifier = Modifier.fillMaxWidth(if (user) 0.9f else 1f),
        ) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 13.dp)) {
                Text(if (user) "Tú" else "Muse",
                    style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                if (item.text.isNotBlank()) Text(item.text, style = MaterialTheme.typography.bodyMedium)
                if (item.hasImage) {
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Image, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Imagen adjunta", style = MaterialTheme.typography.labelMedium)
                    }
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
