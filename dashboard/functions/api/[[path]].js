export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const target = new URL('https://vps-api.selfcloud.workers.dev');
  target.pathname = url.pathname;
  target.search = url.search;

  const headers = new Headers(request.headers);
  if (env.VPS_WORKER_API_KEY) {
    headers.set('X-API-Key', env.VPS_WORKER_API_KEY);
  }

  return fetch(target, { headers });
}
