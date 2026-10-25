package io.muse.remote.core

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.time.TimeSource
import kotlin.random.Random

/**
 * Single owner of remote-session state. UI never speaks MSP or HTTP directly.
 * Every async result is scoped to a session generation to prevent cross-session leaks.
 */
class MuseController(
    private val gateway: MuseGateway,
    private val credentials: CredentialsStore,
    private val discovery: LanDiscovery = EmptyLanDiscovery,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val savedLoginAtStart = credentials.read()
    private val mutable = MutableStateFlow(
        MuseState(
            hiddenSessionIds = credentials.hiddenSessionIds(),
            projects = credentials.projects(), projectAssignments = credentials.projectAssignments(),
            pinnedSessionIds = credentials.pinnedSessionIds(),
            savedConnectionAvailable = savedLoginAtStart != null,
            restoringConnection = savedLoginAtStart != null,
            loading = savedLoginAtStart != null,
            endpoint = savedLoginAtStart?.base.orEmpty(),
        )
    )
    val state: StateFlow<MuseState> = mutable
    private var generation = 0L
    private var openJob: Job? = null
    private var streamJob: Job? = null
    private var syncJob: Job? = null
    private var watchdogJob: Job? = null
    private var started = false
    private var listJob: Job? = null
    private var modelJob: Job? = null
    private var settingsJob: Job? = null
    private var contributorJob: Job? = null

    private var listSequence = 0L
    private var lastEvent = TimeSource.Monotonic.markNow()

    fun bootstrap() {
        if (started) return
        started = true
        savedLoginAtStart?.let { connect(it.url, it.token, it.pin, it.fallbackUrl) }
    }

    fun retrySavedConnection() {
        val saved = credentials.read() ?: run {
            mutable.update { it.copy(savedConnectionAvailable = false) }
            return
        }
        mutable.update { it.copy(restoringConnection = true, loading = true, error = null) }
        connect(saved.url, saved.token, saved.pin, saved.fallbackUrl)
    }

    fun connect(url: String, token: String, pin: String? = null, fallbackUrl: String? = null) {
        val candidate = ServerCredentials(url.trim(), token.trim(), pin?.trim()?.replace(":", ""),
            fallbackUrl?.trim()?.takeIf { it.isNotBlank() })
        try { candidate.validate() }
        catch (e: IllegalArgumentException) {
            mutable.update { it.copy(loading = false, error = e.message) }
            return
        }
        val seq = ++generation
        cancelConversation()
        listJob?.cancel()
        listSequence++
        mutable.update { it.copy(loading = true, error = null, endpoint = candidate.base,
            sessionsLoading = false, sessionsLoaded = false, sessionsError = null,
            sessions = emptyList(), sessionsPageCount = 0) }
        scope.launch {
            try {
                // Wait briefly for mDNS before falling back to the last remembered IP.
                if (candidate.pin != null && discovery.services.value.isEmpty()) delay(1300)
                val lan = discovery.services.value.firstOrNull {
                    it.fingerprint.equals(candidate.pin, ignoreCase = true)
                }
                val candidates = listOfNotNull(lan?.url, candidate.base, candidate.fallbackUrl)
                    .distinct()
                var connected: ServerCredentials? = null
                var lastFailure: Exception? = null
                for (endpoint in candidates) {
                    if (seq != generation) return@launch
                    val usesPin = candidate.pin != null && endpoint != candidate.fallbackUrl
                    val connection = candidate.copy(url = endpoint, pin = if (usesPin) candidate.pin else null)
                    try {
                        gateway.authorize(connection)
                        gateway.checkConnection()
                        connected = connection
                        break
                    } catch (cancel: CancellationException) {
                        throw cancel
                    } catch (e: Exception) {
                        lastFailure = e
                    }
                }
                if (seq != generation) return@launch
                val active = connected ?: throw (lastFailure ?: IllegalStateException("PC no disponible"))
                credentials.save(candidate)
                mutable.update {
                    it.copy(authenticated = true, screen = Screen.Sessions, endpoint = active.base,
                        loading = false, restoringConnection = false, savedConnectionAvailable = true,
                        stream = if (active.pin == null) "Conectado por HTTPS" else "LAN segura",
                        error = null)
                }
                refreshSessions()
                val recent = credentials.recentSession()
                if (!recent.isNullOrBlank() && seq == generation) openSession(recent)
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (t: Exception) {
                if (seq == generation) mutable.update {
                    it.copy(loading = false, restoringConnection = false, authenticated = false,
                        savedConnectionAvailable = true,
                        error = "No se pudo conectar por LAN ni respaldo: " + (t.message ?: "conexión fallida"))
                }
            }
        }
    }

    fun reportError(message: String) { mutable.update { it.copy(error = message) } }

    fun logout() {
        generation++
        cancelConversation()
        listJob?.cancel()
        listSequence++
        gateway.signOut()
        credentials.clear()
        mutable.value = MuseState(hiddenSessionIds = credentials.hiddenSessionIds(),
            projects = credentials.projects(), projectAssignments = credentials.projectAssignments(),
            pinnedSessionIds = credentials.pinnedSessionIds())
    }

    fun hideSession(id: String) {
        if (id == mutable.value.sessionId) return
        credentials.hideSession(id)
        if (credentials.recentSession() == id) credentials.saveRecentSession(null)
        mutable.update { it.copy(hiddenSessionIds = credentials.hiddenSessionIds()) }
    }

    fun restoreSession(id: String) {
        credentials.restoreSession(id)
        mutable.update { it.copy(hiddenSessionIds = credentials.hiddenSessionIds()) }
    }

    fun refreshContributor() {
        if (!mutable.value.authenticated) return
        val seq = generation
        contributorJob?.cancel()
        mutable.update { it.copy(contributorLoading = true) }
        contributorJob = scope.launch {
            try {
                val status = gateway.readContributor()
                if (seq == generation && mutable.value.authenticated) mutable.update {
                    it.copy(contributor = status, contributorLoading = false)
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                if (seq == generation) mutable.update {
                    it.copy(contributorLoading = false,
                        contributor = ContributorStatus(reason = e.message))
                }
            }
        }
    }

    /** Explicit host-wide privacy change; never silently toggled by selecting a model. */
    fun changeContributor(enabled: Boolean, explicitConsent: Boolean) {
        if (!mutable.value.authenticated || mutable.value.contributorSaving ||
            !mutable.value.contributor.available ||
            (enabled && !explicitConsent)) return
        val seq = generation
        mutable.update { it.copy(contributorSaving = true) }
        contributorJob = scope.launch {
            try {
                val status = gateway.changeContributor(enabled, explicitConsent)
                if (seq == generation) mutable.update {
                    it.copy(contributor = status, contributorSaving = false)
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                if (seq == generation) mutable.update {
                    it.copy(contributorSaving = false,
                        contributor = it.contributor.copy(reason = e.message))
                }
            }
        }
    }

    fun createProject(name: String, workspace: String = "") {
        val normalized = name.trim().take(64)
        if (normalized.isBlank()) { reportError("Escribe el nombre del proyecto."); return }
        if (mutable.value.projects.size >= 100) { reportError("Límite de 100 proyectos."); return }
        val id = "p-" + Random.nextLong().toULong().toString(16) +
            Random.nextLong().toULong().toString(16)
        val updated = mutable.value.projects + RemoteProject(id, normalized, workspace.trim().take(512))
        credentials.saveProjects(updated)
        mutable.update { it.copy(projects = updated) }
    }

    fun updateProject(id: String, name: String, workspace: String) {
        if (mutable.value.projects.none { it.id == id } || name.trim().isBlank()) return
        val updated = mutable.value.projects.map {
            if (it.id == id) it.copy(name = name.trim().take(64),
                workspace = workspace.trim().take(512)) else it
        }
        credentials.saveProjects(updated)
        mutable.update { it.copy(projects = updated) }
    }

    fun deleteProject(id: String) {
        if (mutable.value.projects.none { it.id == id }) return
        val projects = mutable.value.projects.filterNot { it.id == id }
        val assignments = mutable.value.projectAssignments.filterValues { it != id }
        credentials.saveProjects(projects)
        credentials.saveProjectAssignments(assignments)
        mutable.update { it.copy(projects = projects, projectAssignments = assignments) }
    }

    fun assignSession(sessionId: String, projectId: String?) {
        if (sessionId.isBlank() || (projectId != null && mutable.value.projects.none { it.id == projectId })) return
        val updated = mutable.value.projectAssignments.toMutableMap()
        if (projectId == null) updated.remove(sessionId)
        else updated[sessionId] = projectId
        credentials.saveProjectAssignments(updated)
        mutable.update { it.copy(projectAssignments = updated) }
    }

    fun togglePinned(sessionId: String) {
        if (sessionId.isBlank()) return
        val updated = mutable.value.pinnedSessionIds.toMutableSet()
        if (!updated.add(sessionId)) updated.remove(sessionId)
        credentials.savePinnedSessionIds(updated)
        mutable.update { it.copy(pinnedSessionIds = updated) }
    }

    fun refreshSessions() {
        if (!mutable.value.authenticated) return
        val seq = ++listSequence
        listJob?.cancel()
        mutable.update { it.copy(sessionsLoading = true, sessionsError = null,
            sessionsPageCount = 0) }
        listJob = scope.launch {
            try {
                val sessions = gateway.listAllSessions { page, partial ->
                    if (seq == listSequence && mutable.value.authenticated) {
                        mutable.update { it.copy(sessionsPageCount = page,
                            sessions = if (partial.isNotEmpty()) partial else it.sessions) }
                    }
                }
                if (seq == listSequence && mutable.value.authenticated) mutable.update {
                    it.copy(sessions = sessions, sessionsLoading = false,
                        sessionsLoaded = true, sessionsError = null)
                }
            } catch (cancel: CancellationException) { throw cancel }
            catch (t: Exception) {
                if (seq == listSequence && mutable.value.authenticated) mutable.update {
                    it.copy(sessionsLoading = false,
                        sessionsError = "No se pudo recuperar la lista: ${t.message ?: "error de Muse"}. " +
                            "Pulsa Reintentar; no se borró ninguna conversación.")
                }
            }
        }
    }

    fun createSession(workspace: String, projectId: String? = null) {
        if (!mutable.value.authenticated) return
        val seq = ++generation
        cancelConversation()
        mutable.update { it.copy(loading = true, error = null) }
        scope.launch {
            try {
                val id = gateway.startSession(workspace)
                if (generation != seq) return@launch
                if (projectId != null) assignSession(id, projectId)
                openSession(id)
                refreshSessions()
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (t: Exception) {
                if (generation == seq) mutable.update { it.copy(loading = false, error = t.message) }
            }
        }
    }

    fun openSession(id: String) {
        if (!mutable.value.authenticated || id.isBlank()) return
        val seq = ++generation
        cancelConversation()
        val known = mutable.value.sessions.firstOrNull { it.id == id }
        mutable.update {
            it.copy(
                screen = Screen.Conversation, sessionId = id,
                sessionTitle = known?.title ?: "Sesión ${id.take(8)}",
                workspace = known?.workspace.orEmpty(),
                models = emptyList(), activeModelId = known?.model?.takeIf(String::isNotBlank),
                reasoningEffort = null, modelSettingsLoading = false,
                modelSettingsSaving = false, modelSettingsError = null,
                items = emptyList(), approvals = emptyList(), questions = emptyList(),
                loading = true, sessionReady = false, sessionBusyElsewhere = false,
                working = false, sending = false,
                turnId = null, viewCursor = null,
                stream = "Solicitando reanudación a Muse…", error = null,
            )
        }
        openJob = scope.launch {
            // If resume is slow, read a snapshot concurrently and display it.
            // Reading never unlocks the composer; only resume can do that.
            var preview: JsonObject? = null
            var readFailure: String? = null
            val previewJob = launch {
                delay(2_500L)
                if (seq != generation || !mutable.value.loading) return@launch
                mutable.update { it.copy(stream = "Buscando historial mientras Muse reanuda…") }
                try {
                    val snapshot = withTimeoutOrNull(100_000L) { gateway.read(id) }
                        ?: error("Tiempo de espera agotado al leer el historial (100 s)")
                    if (seq != generation) return@launch
                    preview = snapshot
                    if (!mutable.value.sessionReady) {
                        mergeHistory(snapshot.obj("history"), seq)
                        mutable.update {
                            it.copy(
                                sessionTitle = snapshot.obj("session")?.string("name")
                                    ?.takeIf(String::isNotBlank) ?: it.sessionTitle,
                                stream = "Historial cargado · esperando reanudación…",
                            )
                        }
                    }
                } catch (cancel: CancellationException) {
                    throw cancel
                } catch (e: Exception) {
                    readFailure = e.message ?: "error desconocido"
                }
            }
            try {
                val result = withTimeoutOrNull(105_000L) {
                    gateway.resume(id) { phase ->
                        if (seq == generation && mutable.value.loading &&
                            mutable.value.items.isEmpty()) {
                            mutable.update { it.copy(stream = phase) }
                        }
                    }
                } ?: error("Tiempo de espera agotado al reanudar la sesión (105 s)")
                if (seq != generation) return@launch
                previewJob.cancel()
                val session = result.obj("session")
                mutable.update {
                    it.copy(
                        loading = false, sessionReady = true, sessionBusyElsewhere = false,
                        sessionTitle = session?.string("name")?.takeIf(String::isNotBlank)
                            ?: it.sessionTitle,
                        workspace = session?.string("workspaceRoot") ?: it.workspace,
                        activeModelId = session?.string("modelId")
                            ?: session?.obj("model")?.string("modelId") ?: it.activeModelId,
                        reasoningEffort = session?.string("reasoningEffort"),
                        working = session?.string("status") == "running",
                        stream = "Conectando directo…",
                        viewCursor = result.string("viewCursor"), error = null,
                    )
                }
                credentials.saveRecentSession(id)
                mergeHistory(result.obj("history"), seq)
                if (seq != generation) return@launch
                startConnection(id, seq)
                refreshPending(id, seq)
                refreshModelSettings()
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (resumeError: Exception) {
                if (seq != generation) return@launch
                mutable.update {
                    it.copy(stream = "Reanudación fallida · comprobando historial…",
                        sessionReady = false)
                }
                // Parallel read avoids a second serial 110-second wait.
                previewJob.join()
                if (seq != generation) return@launch
                val snapshot = preview
                val isOccupied = resumeError.message.orEmpty()
                    .contains("already in use", ignoreCase = true)
                if (snapshot != null) {
                    mergeHistory(snapshot.obj("history"), seq)
                    mutable.update {
                        it.copy(
                            loading = false, sessionReady = false,
                            sessionBusyElsewhere = isOccupied,
                            sessionTitle = snapshot.obj("session")?.string("name")
                                ?.takeIf(String::isNotBlank) ?: it.sessionTitle,
                            stream = if (isOccupied) "Abierta en Terminal" else "Solo lectura",
                            error = if (isOccupied) null else
                                "Muse no permitió reanudar: ${resumeError.message}. " +
                                    "Historial recuperado; pulsa Reintentar para habilitar mensajes."
                        )
                    }
                } else {
                    mutable.update {
                        it.copy(
                            loading = false, sessionReady = false, stream = "No disponible",
                            error = "No se pudo abrir la sesión. Reanudar: ${resumeError.message}; " +
                                "leer historial: ${readFailure ?: "sin respuesta"}. " +
                                "Pulsa Reintentar o prueba una sesión más reciente."
                        )
                    }
                }
            } finally {
                previewJob.cancel()
            }
        }
    }

    fun backToSessions() {
        generation++
        cancelConversation()
        mutable.update {
            it.copy(screen = Screen.Sessions, sessionId = null, items = emptyList(),
                approvals = emptyList(), questions = emptyList(), working = false,
                sessionReady = false, sessionBusyElsewhere = false,
                loading = false, sending = false,
                models = emptyList(), activeModelId = null, reasoningEffort = null,
                modelSettingsLoading = false, modelSettingsSaving = false, modelSettingsError = null,
                turnId = null, viewCursor = null, stream = "PC conectada", error = null)
        }
        refreshSessions()
    }

    /** Session-scoped RPC calls prevent stale settings crossing conversations. */
    fun refreshModelSettings() {
        val current = mutable.value
        val sid = current.sessionId ?: return
        if (!current.sessionReady || current.modelSettingsSaving) return
        val seq = generation
        modelJob?.cancel()
        mutable.update { it.copy(modelSettingsLoading = true, modelSettingsError = null) }
        modelJob = scope.launch {
            try {
                val models = gateway.listModels(sid)
                if (seq != generation || mutable.value.sessionId != sid) return@launch
                mutable.update {
                    it.copy(models = models,
                        activeModelId = models.firstOrNull { m -> m.isActive }?.id
                            ?: it.activeModelId,
                        modelSettingsLoading = false,
                        modelSettingsError = if (models.isEmpty()) "Muse no devolvió modelos." else null)
                }
            } catch (cancel: CancellationException) { throw cancel }
            catch (e: Exception) {
                if (seq == generation && mutable.value.sessionId == sid) mutable.update {
                    it.copy(modelSettingsLoading = false,
                        modelSettingsError = "No se pudo consultar modelos: ${e.message}")
                }
            }
        }
    }

    fun changeModel(modelId: String) {
        val current = mutable.value
        val sid = current.sessionId ?: return
        if (!current.sessionReady || current.working || current.sending ||
            current.modelSettingsSaving || current.modelSettingsLoading ||
            current.models.none { it.id == modelId } || current.activeModelId == modelId) return
        val seq = generation
        mutable.update { it.copy(modelSettingsSaving = true, modelSettingsError = null) }
        settingsJob = scope.launch {
            try {
                gateway.setModel(sid, modelId)
                if (seq != generation || mutable.value.sessionId != sid) return@launch
                mutable.update { it.copy(activeModelId = modelId, reasoningEffort = null,
                    modelSettingsSaving = false, modelSettingsError = null,
                    models = it.models.map { m -> m.copy(isActive = m.id == modelId) }) }
            } catch (cancel: CancellationException) { throw cancel }
            catch (e: Exception) {
                if (seq == generation && mutable.value.sessionId == sid) mutable.update {
                    it.copy(modelSettingsSaving = false,
                        modelSettingsError = "Muse rechazó el modelo: ${e.message}")
                }
            }
        }
    }

    fun changeReasoningEffort(effort: String) {
        val current = mutable.value
        val sid = current.sessionId ?: return
        if (!current.sessionReady || current.working || current.sending ||
            current.modelSettingsSaving || current.modelSettingsLoading ||
            effort !in reasoningEffortLevels || current.reasoningEffort == effort) return
        val seq = generation
        mutable.update { it.copy(modelSettingsSaving = true, modelSettingsError = null) }
        settingsJob = scope.launch {
            try {
                gateway.setReasoningEffort(sid, effort)
                if (seq != generation || mutable.value.sessionId != sid) return@launch
                mutable.update { it.copy(reasoningEffort = effort,
                    modelSettingsSaving = false, modelSettingsError = null) }
            } catch (cancel: CancellationException) { throw cancel }
            catch (e: Exception) {
                if (seq == generation && mutable.value.sessionId == sid) mutable.update {
                    it.copy(modelSettingsSaving = false,
                        modelSettingsError = "Muse rechazó el nivel: ${e.message}")
                }
            }
        }
    }

    fun send(text: String, attachment: ComposerAttachment? = null) {
        val content = text.trim()
        val sid = mutable.value.sessionId ?: return
        if ((content.isBlank() && attachment == null) || mutable.value.sending ||
            !mutable.value.sessionReady) return
        val seq = generation
        mutable.update { it.copy(sending = true, error = null) }
        scope.launch {
            try {
                // Documents are staged on the user's PC before their local
                // filesystem path is passed in a text part to Muse.
                val file = (attachment as? ComposerAttachment.Document)?.let { gateway.upload(it) }
                if (seq != generation) return@launch
                val id = gateway.commandId()
                if (seq != generation) return@launch
                gateway.send(sid, content, id, attachment as? ComposerAttachment.Photo, file)
                if (seq == generation) mutable.update { it.copy(sending = false, working = true) }
                delay(1500)
                if (seq == generation) syncOnce(sid, seq)
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (t: Exception) {
                if (seq == generation) mutable.update {
                    it.copy(sending = false,
                        error = "No se confirmó el envío: ${t.message}. " +
                            "Conserva el adjunto y comprueba el historial antes de reintentar.")
                }
            }
        }
    }

    fun interrupt() {
        val sid = mutable.value.sessionId ?: return
        val seq = generation
        val tid = mutable.value.turnId
        scope.launch {
            try { gateway.interrupt(sid, tid) }
            catch (cancel: CancellationException) { throw cancel }
            catch (t: Exception) {
                if (seq == generation) mutable.update { it.copy(error = "No se pudo detener: ${t.message}") }
            }
        }
    }

    fun decide(approval: PendingApproval, choiceId: String) {
        if (approval.sessionId != mutable.value.sessionId) return
        val seq = generation
        scope.launch {
            try {
                gateway.decide(approval, choiceId)
                if (seq == generation) mutable.update {
                    it.copy(approvals = it.approvals.filterNot { a -> a.id == approval.id })
                }
            } catch (cancel: CancellationException) { throw cancel }
            catch (t: Exception) {
                if (seq == generation) mutable.update { it.copy(error = "No se pudo aprobar: ${t.message}") }
            }
        }
    }

    fun answer(question: PromptQuestion, response: String) {
        if (question.sessionId != mutable.value.sessionId || response.isBlank()) return
        val seq = generation
        scope.launch {
            try {
                gateway.answer(question, response.trim())
                if (seq == generation) mutable.update {
                    it.copy(questions = it.questions.filterNot { q -> q.id == question.id })
                }
            } catch (cancel: CancellationException) { throw cancel }
            catch (t: Exception) {
                if (seq == generation) mutable.update { it.copy(error = "No se pudo responder: ${t.message}") }
            }
        }
    }

    fun dismissError() { mutable.update { it.copy(error = null) } }

    private fun startConnection(sid: String, seq: Long) {
        lastEvent = TimeSource.Monotonic.markNow()
        streamJob = scope.launch {
            while (isActive && seq == generation) {
                try {
                    gateway.events(sid, mutable.value.viewCursor) { method, json ->
                        if (seq != generation) return@events
                        lastEvent = TimeSource.Monotonic.markNow()
                        applyEvent(method, json, seq)
                    }
                } catch (cancel: CancellationException) { throw cancel }
                catch (_: Exception) { /* polling remains available */ }
                if (seq == generation) mutable.update { it.copy(stream = "Reconectando…") }
                if (seq == generation) syncOnce(sid, seq)
                delay(4000)
            }
        }
        // Backstop also covers silent proxy buffering and old sessions without live sidecars.
        syncJob = scope.launch {
            while (isActive && seq == generation) {
                delay(if (mutable.value.working) 7000 else 20000)
                syncOnce(sid, seq)
            }
        }
        watchdogJob = scope.launch {
            while (isActive && seq == generation) {
                delay(12000)
                if (lastEvent.elapsedNow().inWholeSeconds > 50) {
                    streamJob?.cancel()
                    streamJob?.join()
                    if (seq == generation) {
                        mutable.update { it.copy(stream = "Reabriendo conexión…") }
                        streamJob = scope.launch {
                            while (isActive && seq == generation) {
                                try {
                                    gateway.events(sid, mutable.value.viewCursor) { method, json ->
                                        if (seq == generation) {
                                            lastEvent = TimeSource.Monotonic.markNow()
                                            applyEvent(method, json, seq)
                                        }
                                    }
                                } catch (cancel: CancellationException) { throw cancel }
                                catch (_: Exception) {}
                                if (seq == generation) syncOnce(sid, seq)
                                delay(4000)
                            }
                        }
                        lastEvent = TimeSource.Monotonic.markNow()
                    }
                }
            }
        }
    }

    private suspend fun syncOnce(sid: String, seq: Long) {
        if (seq != generation) return
        try {
            val response = gateway.read(sid)
            if (seq != generation) return
            mergeHistory(response.obj("history"), seq)
            val session = response.obj("session")
            if (session != null) mutable.update {
                it.copy(working = session.string("status") == "running",
                    sessionTitle = session.string("name") ?: it.sessionTitle)
            }
            if (lastEvent.elapsedNow().inWholeSeconds > 35) {
                mutable.update { it.copy(stream = "Sin directo · sincronizando") }
            }
            refreshPending(sid, seq)
        } catch (cancel: CancellationException) { throw cancel }
        catch (_: Exception) {
            if (seq == generation) mutable.update { it.copy(stream = "Sin conexión · reintentando") }
        }
    }

    private suspend fun refreshPending(sid: String, seq: Long) {
        try {
            val result = gateway.pending(sid)
            if (seq != generation) return
            val list = result.array("approvals").orEmpty().mapNotNull {
                (it as? JsonObject)?.let(PendingApproval::from)
            }
            mutable.update { it.copy(approvals = list) }
        } catch (cancel: CancellationException) { throw cancel }
        catch (_: Exception) { /* old MSP may not expose pending approvals */ }
    }

    private fun mergeHistory(history: JsonObject?, seq: Long) {
        if (history == null || seq != generation) return
        val incoming = history.array("items").orEmpty().mapNotNull {
            (it as? JsonObject)?.let(ChatItem::from)
        }
        if (incoming.isNotEmpty()) mutable.update { previous ->
            val merged = linkedMapOf<String, ChatItem>()
            previous.items.forEach { merged[it.id] = it }
            incoming.forEach { item ->
                val old = merged[item.id]
                merged[item.id] = if (old != null && item.text.isBlank())
                    item.copy(text = old.text) else item
            }
            val next = merged.values.toList()
            if (next == previous.items) previous else previous.copy(items = next)
        }
        history.array("events").orEmpty().forEach {
            val event = it as? JsonObject ?: return@forEach
            val method = event.string("method") ?: return@forEach
            applyEvent(method, event.obj("params") ?: event, seq)
        }
    }

    private fun upsert(item: ChatItem, seq: Long) {
        if (seq != generation) return
        mutable.update { prev ->
            val index = prev.items.indexOfFirst { it.id == item.id }
            if (index < 0) prev.copy(items = prev.items + item)
            else {
                val old = prev.items[index]
                val merged = item.copy(text = item.text.ifBlank { old.text })
                if (merged == old) prev else prev.copy(items = prev.items.toMutableList().also { it[index] = merged })
            }
        }
    }

    private fun applyEvent(method: String, payload: JsonObject, seq: Long) {
        if (seq != generation) return
        if (method == "subscribed") {
            mutable.update { it.copy(stream = "En vivo", viewCursor = payload.string("viewCursor") ?: it.viewCursor) }
            return
        }
        if (method == "ping") return
        if (method == "bridge") {
            mutable.update {
                it.copy(stream = if (payload.string("__bridge") == "host-down") "Muse reiniciándose…" else "Reconectando…")
            }
            return
        }
        if (method == "error") {
            mutable.update { it.copy(stream = "Sin directo · sincronizando") }
            return
        }
        val p = payload.obj("params") ?: payload
        val owner = p.string("sessionId")
        if (owner != null && owner != mutable.value.sessionId) return
        p.string("viewCursor")?.let { cursor -> mutable.update { it.copy(viewCursor = cursor) } }
        when (method) {
            "item/started", "item/updated", "item/completed" -> {
                val item = p.obj("item")?.let(ChatItem::from) ?: return
                upsert(item, seq)
            }
            "item/delta" -> {
                val id = p.string("itemId") ?: return
                val delta = p.string("delta").orEmpty()
                mutable.update { previous ->
                    val ix = previous.items.indexOfFirst { it.id == id }
                    if (ix == -1) previous.copy(items = previous.items + ChatItem(id, "agentMessage", delta, "", "", ""))
                    else previous.copy(items = previous.items.toMutableList().also {
                        val old = it[ix]
                        it[ix] = old.copy(text = old.text + delta)
                    })
                }
            }
            "turn/started" -> mutable.update {
                it.copy(working = true, turnId = p.string("turnId") ?: it.turnId)
            }
            "turn/completed", "turn/retracted" -> mutable.update {
                if (p.string("turnId") == null || it.turnId == null || p.string("turnId") == it.turnId)
                    it.copy(working = false, turnId = null) else it
            }
            "session/statusChanged" -> mutable.update {
                it.copy(working = p.string("status") == "running")
            }
            "approval/request", "approval/requested" -> {
                PendingApproval.from(p)?.let { a ->
                    if (a.sessionId == mutable.value.sessionId) mutable.update {
                        it.copy(approvals = it.approvals.filterNot { x -> x.id == a.id } + a)
                    }
                }
            }
            "approval/resolved" -> mutable.update {
                it.copy(approvals = it.approvals.filterNot { a -> a.id == p.string("approvalId") })
            }
            "userInput/request", "userInput/requested" -> {
                PromptQuestion.from(p)?.let { q ->
                    if (q.sessionId == mutable.value.sessionId) mutable.update {
                        it.copy(questions = it.questions.filterNot { x -> x.id == q.id } + q)
                    }
                }
            }
            "userInput/settled" -> mutable.update {
                it.copy(questions = it.questions.filterNot { q -> q.id == p.string("userInputId") })
            }
        }
    }

    private fun cancelConversation() {
        openJob?.cancel(); streamJob?.cancel(); syncJob?.cancel(); watchdogJob?.cancel()
        modelJob?.cancel(); settingsJob?.cancel(); contributorJob?.cancel()
        openJob = null; streamJob = null; syncJob = null; watchdogJob = null
    }

    fun close() {
        generation++
        cancelConversation()
        scope.cancel()
        gateway.close()
    }
}
