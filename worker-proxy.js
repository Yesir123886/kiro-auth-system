// ANGEL API Proxy Worker
// 解决 HTTPS 站点访问 HTTP API 的 mixed content 限制
// 部署后地址: https://angel-api-proxy.<YOUR_ACCOUNT_ID>.workers.dev/proxy/*

const TARGET_BASE = 'http://hp.hysafe.top:15110';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 只代理 /proxy/ 路径的请求
    if (url.pathname.startsWith('/proxy/')) {
      const targetPath = url.pathname.slice(7); // 去掉 '/proxy/'
      const targetUrl = TARGET_BASE + '/' + targetPath + url.search;

      try {
        const newRequest = new Request(targetUrl, {
          method: request.method,
          headers: {
            'Content-Type': request.headers.get('Content-Type') || 'application/json',
            'Origin': TARGET_BASE,
          },
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
          redirect: 'follow',
        });

        const response = await fetch(newRequest);

        // 创建新响应并添加 CORS 头
        const newResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Content-Type': response.headers.get('Content-Type') || 'application/json',
          },
        });

        return newResponse;
      } catch (err) {
        return new Response(JSON.stringify({
          ok: false,
          error: 'Proxy error: ' + err.message,
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // 处理 CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // 默认返回提示
    return new Response(JSON.stringify({
      ok: false,
      error: 'API Proxy - use /proxy/ prefix for requests',
      usage: 'POST /proxy/api/generate with {creator_key, auth_id}',
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
