export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(request),
      });
    }

    const apiKey = request.headers.get('X-API-Key');
    if (path.startsWith('/api/') && apiKey !== env.VPS_WORKER_API_KEY) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }

    try {
      if (path === '/api/record' && request.method === 'POST') {
        return handleRecord(request, env);
      }
      if (path === '/api/batch' && request.method === 'POST') {
        return handleBatch(request, env);
      }
      if (path === '/api/list' && request.method === 'GET') {
        return handleList(request, env, url);
      }
      if (path === '/api/latest' && request.method === 'GET') {
        return handleLatest(request, env, url);
      }
      if (path === '/api/collections' && request.method === 'GET') {
        return handleCollections(env);
      }
      if (path === '/api/cleanup' && request.method === 'POST') {
        return handleCleanup(request, env);
      }

      return jsonResponse({ error: 'not found' }, 404);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  },
};

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleRecord(request, env) {
  const { collection, data } = await request.json();

  if (!collection || !data) {
    return jsonResponse({ error: 'collection and data required' }, 400);
  }

  const result = await env.VPS_DB.prepare(
    'INSERT INTO records (collection, data) VALUES (?, ?)'
  ).bind(collection, JSON.stringify(data)).run();

  return jsonResponse({ inserted: result.meta.changes });
}

async function handleBatch(request, env) {
  const { collection, records } = await request.json();

  if (!collection || !records || !Array.isArray(records)) {
    return jsonResponse({ error: 'collection and records[] required' }, 400);
  }

  const stmt = env.VPS_DB.prepare(
    'INSERT INTO records (collection, data) VALUES (?, ?)'
  );

  const batch = records.map(r =>
    stmt.bind(r.collection || collection, JSON.stringify(r.data))
  );

  const results = await env.VPS_DB.batch(batch);
  const total = results.reduce((sum, r) => sum + (r.meta?.changes || 0), 0);

  return jsonResponse({ inserted: total });
}

async function handleList(request, env, url) {
  const collection = url.searchParams.get('collection') || 'speed_test';
  const limit = parseInt(url.searchParams.get('limit') || '10', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const since = url.searchParams.get('since');

  let sql = 'SELECT data, created_at FROM records WHERE collection = ?';
  const params = [collection];

  if (since) {
    sql += ' AND created_at >= ?';
    params.push(normalizeD1Time(since));
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Math.min(limit, 5000), offset);

  const { results } = await env.VPS_DB.prepare(sql).bind(...params).all();

  const records = results.map(r => ({
    ...JSON.parse(r.data),
    created_at: r.created_at,
  }));

  return jsonResponse({ collection, count: records.length, records });
}

function normalizeD1Time(iso) {
  return iso.replace('T', ' ').replace(/\.\d+/, '').replace(/[+-]\d{2}:\d{2}$/, '').replace(/Z$/, '');
}

async function handleLatest(request, env, url) {
  const collection = url.searchParams.get('collection') || 'speed_test';

  const { results: batchResults } = await env.VPS_DB.prepare(
    `SELECT data FROM records
     WHERE collection = ?
       AND json_extract(data, '$.tested_at') = (
         SELECT MAX(json_extract(data, '$.tested_at'))
         FROM records WHERE collection = ?
       )`
  ).bind(collection, collection).all();

  if (batchResults.length > 0) {
    const records = batchResults.map(r => JSON.parse(r.data));
    return jsonResponse({ collection, count: records.length, records });
  }

  // Fallback: latest batch by created_at (每批同時寫入的紀錄)
  const { results } = await env.VPS_DB.prepare(
    `SELECT data, created_at FROM records
     WHERE collection = ?
       AND created_at = (SELECT MAX(created_at) FROM records WHERE collection = ?)
     ORDER BY created_at DESC`
  ).bind(collection, collection).all();

  const records = results.map(r => ({
    ...JSON.parse(r.data),
    created_at: r.created_at,
  }));

  return jsonResponse({ collection, count: records.length, records });
}

async function handleCollections(env) {
  const { results } = await env.VPS_DB.prepare(
    `SELECT collection, COUNT(*) as count FROM records
     GROUP BY collection ORDER BY collection`
  ).all();

  return jsonResponse({ collections: results });
}

async function handleCleanup(request, env) {
  const { collection, cutoff } = await request.json();

  if (!collection || !cutoff) {
    return jsonResponse({ error: 'collection and cutoff required' }, 400);
  }

  const result = await env.VPS_DB.prepare(
    'DELETE FROM records WHERE collection = ? AND created_at < ?'
  ).bind(collection, cutoff).run();

  return jsonResponse({ deleted: result.meta.changes });
}
