// ANGEL API Proxy Worker - v2
// 部署地址: https://angelapiproxy.1354137307.workers.dev

const TARGET_BASE = 'http://hp.hysafe.top:15110';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 健康检查 - 立即返回，不依赖目标服务器
    if (url.pathname === '/ping' || url.pathname === '/') {
      return new Response(JSON.stringify({
        ok: true,
        status: 'Worker 运行正常',
        target: TARGET_BASE,
        time: new Date().toISOString(),
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 代理 /proxy/ 路径
    if (url.pathname.startsWith('/proxy/')) {
      const targetPath = url.pathname.slice(7);
      const targetUrl = TARGET_BASE + '/' + targetPath + url.search;

      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 8000); // 8秒超时

        const resp = await fetch(targetUrl, {
          method: request.method,
          headers: { 'Content-Type': request.headers.get('Content-Type') || 'application/json' },
          body: request.method !== 'GET' ? request.body : undefined,
          signal: controller.signal,
          redirect: 'follow',
        });

        return new Response(resp.body, {
          status: resp.status,
          statusText: resp.statusText,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': resp.headers.get('Content-Type') || 'application/json',
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({
          ok: false,
          error: err.name === 'AbortError' ? '连接超时(8s)：目标服务器无响应' : 'Proxy error: ' + err.message,
          target: targetUrl,
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // 默认
    return new Response(JSON.stringify({
      ok: false,
      usage: 'GET /ping (健康检查) | POST /proxy/api/* (代理请求)',
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
