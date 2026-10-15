package io.muse.remote.core

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.time.TimeSource

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
    private val mutable = MutableStateFlow(MuseState())
    val state: StateFlow<MuseState> = mutable
    private var generation = 0L
    private var streamJob: Job? = null
    private var syncJob: Job? = null
    private var watchdogJob: Job? = null
    private var started = false
    private var lastEvent = TimeSource.Monotonic.markNow()

    fun bootstrap() {
        if (started) return
        started = true
        credentials.read()?.let { connect(it.url, it.token, it.pin, it.fallbackUrl) }
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
        mutable.update { it.copy(loading = true, error = null, endpoint = candidate.base) }
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
                        loading = false, stream = if (active.pin == null) "Conectado por HTTPS" else "LAN segura",
                        error = null)
                }
                refreshSessions()
                val recent = credentials.recentSession()
                if (!recent.isNullOrBlank() && seq == generation) openSession(recent)
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (t: Exception) {
                if (seq == generation) mutable.update {
                    it.copy(loading = false, authenticated = false,
                        error = "No se pudo conectar por LAN ni respaldo: " + (t.message ?: "conexión fallida"))
                }
            }
        }
    }

    fun reportError(message: String) { mutable.update { it.copy(error = message) } }

    fun logout() {
        generation++
        cancelConversation()
        gateway.signOut()
        credentials.clear()
        mutable.value = MuseState()
    }

    fun refreshSessions() {
        if (!mutable.value.authenticated) return
        scope.launch {
            try {
                val sessions = gateway.listAllSessions()
                if (mutable.value.authenticated) mutable.update { it.copy(sessions = sessions) }
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (t: Exception) {
                mutable.update { it.copy(error = "No se pudieron listar las sesiones: ${t.message}") }
            }
        }
    }

    fun createSession(workspace: String) {
        if (!mutable.value.authenticated) return
        val seq = ++generation
        cancelConversation()
        mutable.update { it.copy(loading = true, error = null) }
        scope.launch {
            try {
                val id = gateway.startSession(workspace)
                if (generation != seq) return@launch
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
        if (!mutable.value.authenticated) return
        val seq = ++generation
        cancelConversation()
        mutable.update { it.copy(loading = true, error = null) }
        scope.launch {
            try {
                val result = gateway.resume(id)
                if (seq != generation) return@launch
                val session = result.obj("session")
                val known = mutable.value.sessions.firstOrNull { it.id == id }
                val working = session?.string("status") == "running"
                mutable.update {
                    it.copy(
                        screen = Screen.Conversation, loading = false,
                        sessionId = id, sessionTitle = session?.string("name")
                            ?: known?.title ?: "Sesión ${id.take(8)}",
                        workspace = session?.string("workspaceRoot") ?: known?.workspace.orEmpty(),
                        items = emptyList(), approvals = emptyList(), questions = emptyList(),
                        working = working, turnId = null, stream = "Conectando…",
                        viewCursor = result.string("viewCursor"), error = null,
                    )
                }
                credentials.saveRecentSession(id)
                mergeHistory(result.obj("history"), seq)
                if (seq != generation) return@launch
                startConnection(id, seq)
                refreshPending(id, seq)
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (t: Exception) {
                if (seq == generation) mutable.update { it.copy(loading = false, error = t.message) }
            }
        }
    }

    fun backToSessions() {
        generation++
        cancelConversation()
        mutable.update {
            it.copy(screen = Screen.Sessions, sessionId = null, items = emptyList(),
                approvals = emptyList(), questions = emptyList(), working = false,
                turnId = null, viewCursor = null, stream = "PC conectada", error = null)
        }
        refreshSessions()
    }

    fun send(text: String) {
        val content = text.trim()
        val sid = mutable.value.sessionId ?: return
        if (content.isBlank() || mutable.value.sending) return
        val seq = generation
        mutable.update { it.copy(sending = true, error = null) }
        scope.launch {
            try {
                val id = gateway.commandId()
                if (seq != generation) return@launch
                gateway.send(sid, content, id)
                if (seq == generation) mutable.update { it.copy(sending = false, working = true) }
                // Reconcile immediately; a proxy may buffer the SSE despite a 200 response.
                delay(1500)
                if (seq == generation) syncOnce(sid, seq)
            } catch (cancel: CancellationException) {
                throw cancel
            } catch (t: Exception) {
                if (seq == generation) mutable.update {
                    it.copy(sending = false,
                        error = "No se confirmó el envío: ${t.message}. Comprueba el historial antes de reintentar.")
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
        streamJob?.cancel(); syncJob?.cancel(); watchdogJob?.cancel()
        streamJob = null; syncJob = null; watchdogJob = null
    }

    fun close() {
        generation++
        cancelConversation()
        scope.cancel()
        gateway.close()
    }
}
