// ANGEL API Proxy Worker - v3 (with KV storage)
// 部署地址: https://angelapiproxy.1354137307.workers.dev

const TARGET_BASE = 'http://hp.hysafe.top:15110';

// ====== KV 辅助函数 ======
// 获取所有申请
async function getAllApplications(env) {
  const list = await env.ANGEL_AUTH.list({ prefix: 'app_' });
  const results = [];
  for (const key of list.keys) {
    const data = await env.ANGEL_AUTH.get(key.name, 'json');
    if (data) results.push(data);
  }
  return results.sort((a, b) => b.submit_time - a.submit_time);
}

// 保存申请
async function saveApplication(env, app) {
  await env.ANGEL_AUTH.put('app_' + app.id, JSON.stringify(app));
}

// 更新申请状态
async function updateApplication(env, id, updates) {
  const raw = await env.ANGEL_AUTH.get('app_' + id);
  if (!raw) return null;
  const app = JSON.parse(raw);
  Object.assign(app, updates);
  await env.ANGEL_AUTH.put('app_' + id, JSON.stringify(app));
  return app;
}

// 生成授权码
function generateAuthCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code; // 格式: XXXX-XXXX-XXXX
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 健康检查
    if (url.pathname === '/ping' || url.pathname === '/') {
      return new Response(JSON.stringify({
        ok: true,
        status: 'Worker 运行正常',
        target: TARGET_BASE,
        time: new Date().toISOString(),
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // ====== 用户提交授权申请 ======
    if (url.pathname === '/proxy/api/apply' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { user_id, card_key, screenshot_url } = body;

        if (!user_id || !card_key) {
          return new Response(JSON.stringify({
            ok: false,
            error: '用户ID和卡密为必填项'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const app = {
          id: 'app_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
          user_id,
          card_key,
          screenshot_url: screenshot_url || '',
          status: 'pending',       // pending | approved | rejected
          submit_time: Date.now(),
          submit_date: new Date().toLocaleString('zh-CN'),
          auth_code: '',
          admin_note: '',
        };

        await saveApplication(env, app);

        return new Response(JSON.stringify({
          ok: true,
          message: '申请已提交，请等待管理员审核',
          app_id: app.id,
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        return new Response(JSON.stringify({
          ok: false,
          error: '提交失败: ' + err.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ====== 管理员查看所有申请 ======
    if (url.pathname === '/proxy/api/admin/applications' && request.method === 'GET') {
      try {
        const apps = await getAllApplications(env);
        return new Response(JSON.stringify({
          ok: true,
          total: apps.length,
          pending: apps.filter(a => a.status === 'pending').length,
          data: apps,
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        return new Response(JSON.stringify({
          ok: false,
          error: err.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ====== 管理员审批通过 ======
    if (url.pathname === '/proxy/api/admin/approve' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { app_id, auth_code, admin_note } = body;

        if (!app_id) {
          return new Response(JSON.stringify({
            ok: false,
            error: 'app_id 为必填项'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const finalCode = auth_code || generateAuthCode();
        const app = await updateApplication(env, app_id, {
          status: 'approved',
          auth_code: finalCode,
          admin_note: admin_note || '',
          approve_time: Date.now(),
          approve_date: new Date().toLocaleString('zh-CN'),
        });

        if (!app) {
          return new Response(JSON.stringify({
            ok: false,
            error: '申请不存在'
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        return new Response(JSON.stringify({
          ok: true,
          message: '审批通过',
          auth_code: finalCode,
          user_id: app.user_id,
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        return new Response(JSON.stringify({
          ok: false,
          error: err.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ====== 管理员拒绝 ======
    if (url.pathname === '/proxy/api/admin/reject' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { app_id, admin_note } = body;

        if (!app_id) {
          return new Response(JSON.stringify({
            ok: false,
            error: 'app_id 为必填项'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const app = await updateApplication(env, app_id, {
          status: 'rejected',
          admin_note: admin_note || '',
          reject_time: Date.now(),
          reject_date: new Date().toLocaleString('zh-CN'),
        });

        if (!app) {
          return new Response(JSON.stringify({
            ok: false,
            error: '申请不存在'
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        return new Response(JSON.stringify({
          ok: true,
          message: '已拒绝申请',
          user_id: app.user_id,
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        return new Response(JSON.stringify({
          ok: false,
          error: err.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ====== 用户查询授权状态 ======
    if (url.pathname === '/proxy/api/check' && request.method === 'GET') {
      try {
        const user_id = url.searchParams.get('user_id');
        if (!user_id) {
          return new Response(JSON.stringify({
            ok: false,
            error: 'user_id 参数必填'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const apps = await getAllApplications(env);
        const userApps = apps.filter(a => a.user_id === user_id);

        if (userApps.length === 0) {
          return new Response(JSON.stringify({
            ok: true,
            found: false,
            message: '未找到相关申请记录'
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const latest = userApps[0];
        return new Response(JSON.stringify({
          ok: true,
          found: true,
          status: latest.status,
          auth_code: latest.status === 'approved' ? latest.auth_code : '',
          message: latest.status === 'pending' ? '申请审核中，请耐心等待' :
                   latest.status === 'approved' ? '恭喜！授权已通过，您的授权码是: ' + latest.auth_code :
                   '申请已被拒绝，原因: ' + (latest.admin_note || '未说明'),
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (err) {
        return new Response(JSON.stringify({
          ok: false,
          error: err.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // ====== 代理 /proxy/hysafe/ 路径到 hysafe 后端 ======
    if (url.pathname.startsWith('/proxy/hysafe/')) {
      const targetPath = url.pathname.slice(15);
      const targetUrl = TARGET_BASE + '/' + targetPath + (url.search || '');

      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 8000);

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
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // 默认 404
    return new Response(JSON.stringify({
      ok: false,
      error: 'Not Found',
      usage: `
GET  /ping                                          - 健康检查
POST /proxy/api/apply                              - 用户提交申请
GET  /proxy/api/admin/applications                  - 管理员查看申请列表
POST /proxy/api/admin/approve                      - 管理员审批通过
POST /proxy/api/admin/reject                       - 管理员拒绝
GET  /proxy/api/check?user_id=xxx                - 用户查询授权状态
POST /proxy/hysafe/api/*                          - 代理到 hysafe 后端
      `,
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};
