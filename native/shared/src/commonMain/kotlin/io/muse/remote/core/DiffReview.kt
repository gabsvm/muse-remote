package io.muse.remote.core

import kotlinx.serialization.json.*

/**
 * Pure, bounded, read-only parser for stored patch previews. Supported forms:
 * unified diff text or JSON {files:[{path,newPath,hunks:[{header,lines:[]}]}]}.
 * Unknown schemas remain inspectable as raw text; never pretend they are diffs.
 */
data class DiffReviewLine(val value: String, val type: String)
data class DiffReviewFile(val path: String, val lines: List<DiffReviewLine>) {
    val additions get() = lines.count { it.type == "added" }
    val removals get() = lines.count { it.type == "removed" }
}
data class DiffReviewDocument(val files: List<DiffReviewFile>, val fallback: String) {
    val recognized get() = files.isNotEmpty()
}

private fun JsonObject.textOf(vararg keys: String): String? =
    keys.firstNotNullOfOrNull { (get(it) as? JsonPrimitive)?.contentOrNull }

private fun classify(line: String): String = when {
    line.startsWith("+") && !line.startsWith("+++") -> "added"
    line.startsWith("-") && !line.startsWith("---") -> "removed"
    line.startsWith("@@") -> "hunk"
    else -> "context"
}

private fun lineFromJson(element: JsonElement): DiffReviewLine? {
    val text = when (element) {
        is JsonPrimitive -> element.contentOrNull
        is JsonObject -> element.textOf("text", "content", "value", "line")
        else -> null
    } ?: return null
    val kind = (element as? JsonObject)?.textOf("kind", "type", "operation")
        ?.lowercase()
    val category = when (kind) {
        "added", "addition", "add", "insert", "+" -> "added"
        "removed", "remove", "removal", "delete", "del", "-" -> "removed"
        "header", "hunk" -> "hunk"
        else -> classify(text)
    }
    return DiffReviewLine(text.take(2000), category)
}

private fun parseStructuredPatch(json: JsonObject): List<DiffReviewFile> {
    val entries = (json["files"] as? JsonArray) ?: return emptyList()
    return entries.take(100).mapNotNull { entry ->
        val file = entry as? JsonObject ?: return@mapNotNull null
        val path = file.textOf("newPath", "path", "file", "filename", "oldPath")
            ?.take(300)?.takeIf(String::isNotBlank) ?: return@mapNotNull null
        val lines = mutableListOf<DiffReviewLine>()
        val hunks = (file["hunks"] as? JsonArray)
        if (hunks != null) hunks.take(250).forEach { h ->
            val hunk = h as? JsonObject ?: return@forEach
            hunk.textOf("header", "range")?.let {
                lines.add(DiffReviewLine(it.take(300), "hunk"))
            }
            (hunk["lines"] as? JsonArray)?.take(2500)?.mapNotNull(::lineFromJson)
                ?.let(lines::addAll)
        }
        if (hunks == null) (file["lines"] as? JsonArray)
            ?.take(5000)?.mapNotNull(::lineFromJson)?.let(lines::addAll)
        if (lines.isEmpty()) return@mapNotNull null
        DiffReviewFile(path, lines.take(5000))
    }
}

private fun parseUnifiedDiff(raw: String): List<DiffReviewFile> {
    val result = mutableListOf<DiffReviewFile>()
    var path: String? = null
    var lines = mutableListOf<DiffReviewLine>()
    fun flush() {
        if (path != null && lines.isNotEmpty()) result.add(DiffReviewFile(path!!, lines.toList()))
        lines = mutableListOf()
    }
    raw.lineSequence().take(15000).forEach { line ->
        if (line.startsWith("diff --git ")) {
            flush()
            path = line.substringAfter(" b/", "").ifBlank {
                line.substringAfter("diff --git ").take(300)
            }.take(300)
        } else if (line.startsWith("+++ b/")) {
            if (path == null) path = line.removePrefix("+++ b/").take(300)
        } else if (path != null && (line.startsWith("@@") ||
                line.startsWith("+") || line.startsWith("-") ||
                line.startsWith(" ") || line.startsWith("\\ No newline"))) {
            lines.add(DiffReviewLine(line.take(2000), classify(line)))
        }
    }
    flush()
    return result.take(100)
}

fun parseDiffReview(raw: String): DiffReviewDocument {
    if (raw.isBlank()) return DiffReviewDocument(emptyList(), "")
    val bounded = raw.take(50000)
    val files = if (bounded.trimStart().startsWith("{")) {
        val obj = runCatching { wireJson.parseToJsonElement(bounded) as? JsonObject }.getOrNull()
        obj?.let(::parseStructuredPatch).orEmpty()
    } else parseUnifiedDiff(bounded)
    return DiffReviewDocument(files, bounded)
}
