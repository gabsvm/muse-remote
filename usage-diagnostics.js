'use strict';
/**
 * Explicitly requested subscription allowance diagnostics via `muse usage --json`.
 * The official Muse command documents this as "no model turn".
 * Output is strictly allowlisted: NEVER return the raw CLI JSON/account metadata.
 * One invocation per host per minute (including concurrent requests).
 */
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
let cached = null;
let cachedAt = 0;
let inflight = null;
const PERIOD_MS = 60_000;

function normalizeUsageReport(raw, now = Date.now()) {
  const data = JSON.parse(raw);
  if (!data || data.schemaVersion !== 1 || typeof data !== 'object') {
    throw Error('unsupported usage report');
  }
  const available = data.allowance != null && typeof data.allowance === 'object';
  // Never propagate provider error hints verbatim (may contain local details).
  const reason = !available && data.reason === 'server_sent_no_usage'
    ? 'server_sent_no_usage' : (!available ? 'not_reported' : 'available');
  const message = available
    ? 'Muse devolvió una medición de cuota. Podés consultar los porcentajes observados.'
    : reason === 'server_sent_no_usage'
      ? 'Muse respondió, pero su servidor no devolvió porcentajes de uso para esta ventana.'
      : 'Muse Code no devolvió una medición de cuota. Revisá la suscripción desde la PC.';
  return { available, reason, message, checkedAtMs: now };
}

function execUsage() {
  return new Promise((resolve,reject) => {
    const env = { ...process.env };
    delete env.META_API_KEY;
    // Do not allow caller-supplied commands or flags.
    execFile('muse', ['usage', '--json'], {
      timeout: 15_000, maxBuffer: 32 * 1024, windowsHide: true, shell: false, env
    }, (err, stdout) => {
      if (err) { reject(Error('No se pudo consultar la cuota de Muse Code en la PC.')); return; }
      try { resolve(normalizeUsageReport(stdout)); }
      catch { reject(Error('Muse devolvió un formato de cuota no compatible.')); }
    });
  });
}

function usageDiagnostics() {
  const now = Date.now();
  if (cached && now - cachedAt < PERIOD_MS) return Promise.resolve({ ...cached, cached: true });
  if (inflight) return inflight;
  inflight = execUsage().then(result => {
    cached = result; cachedAt = Date.now(); return { ...result, cached: false };
  }).catch(() => {
    // A failed CLI launch also counts against the rate limit; never fork
    // unlimited processes when the button is tapped repeatedly.
    cached = { available: false, reason: 'cli_unavailable',
      message: 'El comando de cuota de Muse no está disponible desde el puente Windows.',
      checkedAtMs: Date.now() };
    cachedAt = Date.now();
    return { ...cached, cached: false };
  }).finally(() => { inflight = null; });
  return inflight;
}

module.exports = { normalizeUsageReport, usageDiagnostics };
