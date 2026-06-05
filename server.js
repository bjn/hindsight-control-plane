'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number.parseInt(process.env.PORT || '9999', 10);
const HOSTNAME = process.env.HOSTNAME || '0.0.0.0';
const HINDSIGHT_API_URL = normalizeBaseUrl(
  process.env.HINDSIGHT_API_URL ||
  process.env.HINDSIGHT_CP_DATAPLANE_API_URL ||
  'http://hindsight-memory:8888'
);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.HINDSIGHT_TIMEOUT_MS || '20000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function safeInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function encodePathPart(value) {
  return encodeURIComponent(String(value));
}

function isReadOnlyExplorerRoute(method, pathname) {
  if (pathname === '/api/banks' || pathname === '/api/health' || pathname === '/api/config') {
    return method === 'GET';
  }
  if (pathname.match(/^\/api\/banks\/[^/]+\/recall$/)) return method === 'POST';
  if (pathname.match(/^\/api\/banks\/[^/]+\/(stats|tags|memories|documents|operations)$/)) return method === 'GET';
  return false;
}

function securityHeaders(contentType = 'application/octet-stream', cacheControl) {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
    'Cache-Control': cacheControl || (contentType.startsWith('text/html') ? 'no-store' : 'max-age=300, immutable')
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, securityHeaders('application/json; charset=utf-8', 'no-store'));
  res.end(JSON.stringify(data));
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, securityHeaders(contentType));
  res.end(text);
}

function publicContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function hindsightFetch(upstreamPath, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const method = options.method || 'GET';
  const headers = { Accept: 'application/json' };
  let body;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  try {
    const response = await fetch(`${HINDSIGHT_API_URL}${upstreamPath}`, {
      method,
      headers,
      body,
      signal: controller.signal
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { text };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, data };
    }
    return { ok: true, status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeBanksPayload(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.banks)) return data.banks;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

async function handleApi(req, res, url) {
  if (!isReadOnlyExplorerRoute(req.method, url.pathname)) {
    return sendJson(res, 405, {
      error: 'not_allowed',
      message: 'This explorer only exposes read-only Hindsight endpoints plus recall search.'
    });
  }

  if (url.pathname === '/api/config') {
    return sendJson(res, 200, {
      service: 'Hindsight Explorer',
      upstream: new URL(HINDSIGHT_API_URL).host,
      mode: 'read_only'
    });
  }

  if (url.pathname === '/api/health') {
    const upstream = await hindsightFetch('/health');
    return sendJson(res, upstream.ok ? 200 : 502, {
      explorer: 'ok',
      hindsight: upstream.data,
      upstream_status: upstream.status
    });
  }

  if (url.pathname === '/api/banks') {
    const upstream = await hindsightFetch('/v1/default/banks');
    if (!upstream.ok) return sendJson(res, 502, { error: 'hindsight_banks_failed', upstream });
    const banks = summarizeBanksPayload(upstream.data);
    const enriched = await Promise.all(banks.map(async (bank) => {
      const bankId = bank.bank_id || bank.id || bank.name;
      if (!bankId) return bank;
      const stats = await hindsightFetch(`/v1/default/banks/${encodePathPart(bankId)}/stats`);
      return { ...bank, stats: stats.ok ? stats.data : null };
    }));
    return sendJson(res, 200, { banks: enriched });
  }

  const match = url.pathname.match(/^\/api\/banks\/([^/]+)\/(stats|tags|memories|documents|operations|recall)$/);
  if (!match) return sendJson(res, 404, { error: 'not_found' });

  const bankId = decodeURIComponent(match[1]);
  const resource = match[2];
  const encodedBank = encodePathPart(bankId);

  if (resource === 'recall') {
    let body = {};
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      return sendJson(res, 400, { error: 'invalid_json' });
    }
    const query = String(body.query || '').trim();
    if (!query) return sendJson(res, 400, { error: 'missing_query' });
    if (query.length > 2000) return sendJson(res, 400, { error: 'query_too_long', max_chars: 2000 });
    const payload = {
      query,
      budget: ['low', 'mid', 'high'].includes(body.budget) ? body.budget : 'mid',
      max_tokens: safeInt(body.max_tokens, 2048, 256, 8192),
      trace: Boolean(body.trace),
      include: body.include && typeof body.include === 'object' ? body.include : {},
      types: Array.isArray(body.types) ? body.types.filter((x) => ['world', 'experience', 'observation'].includes(x)) : ['world', 'experience']
    };
    const upstream = await hindsightFetch(`/v1/default/banks/${encodedBank}/memories/recall`, {
      method: 'POST',
      body: payload
    });
    return sendJson(res, upstream.ok ? 200 : 502, upstream.ok ? upstream.data : { error: 'hindsight_recall_failed', upstream });
  }

  const limit = safeInt(url.searchParams.get('limit'), 25, 1, 100);
  const offset = safeInt(url.searchParams.get('offset'), 0, 0, 100000);
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const status = url.searchParams.get('status');
  if (resource === 'operations' && status) query.set('status', status);

  let upstreamPath;
  if (resource === 'memories') upstreamPath = `/v1/default/banks/${encodedBank}/memories/list?${query}`;
  else upstreamPath = `/v1/default/banks/${encodedBank}/${resource}${resource === 'stats' || resource === 'tags' ? '' : `?${query}`}`;

  const upstream = await hindsightFetch(upstreamPath);
  return sendJson(res, upstream.ok ? 200 : 502, upstream.ok ? upstream.data : { error: `hindsight_${resource}_failed`, upstream });
}

async function serveStatic(req, res, url) {
  let requested = decodeURIComponent(url.pathname);
  if (requested === '/') requested = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Forbidden');
  try {
    const data = await fs.readFile(filePath);
    return sendText(res, 200, data, publicContentType(filePath));
  } catch (error) {
    if (requested !== '/index.html') {
      try {
        const data = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'));
        return sendText(res, 200, data, 'text/html; charset=utf-8');
      } catch {}
    }
    return sendText(res, 404, 'Not Found');
  }
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/health') return sendJson(res, 200, { status: 'ok' });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    const message = error && error.name === 'AbortError' ? 'Upstream request timed out' : 'Internal error';
    return sendJson(res, 500, { error: 'server_error', message });
  }
}

function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res);
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOSTNAME, () => {
    console.log(`Hindsight Explorer listening on http://${HOSTNAME}:${PORT}`);
    console.log(`Read-only upstream: ${HINDSIGHT_API_URL}`);
  });
}

module.exports = {
  normalizeBaseUrl,
  safeInt,
  isReadOnlyExplorerRoute,
  summarizeBanksPayload,
  createServer
};
