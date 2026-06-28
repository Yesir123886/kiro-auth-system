// Cloudflare Pages Function - 实时从 Gitee 拉取参数文件
// GET /api/params/公益.json → fetch from Gitee → download
//
// 用户只需在 Gitee 上传参数，无需任何部署步骤

const GITEE_RAW = 'https://gitee.com/yesirsadad/cloud-parameter-update/raw/master';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 提取文件名：/api/params/公益.json → 公益.json
  const file = url.pathname.replace('/api/params/', '');

  if (!file) {
    return new Response(JSON.stringify({ ok: false, error: '缺少文件名' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const giteeUrl = GITEE_RAW + '/' + encodeURIComponent(file);

  try {
    const resp = await fetch(giteeUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      },
      redirect: 'follow',
    });

    if (!resp.ok) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Gitee 返回 HTTP ' + resp.status,
      }), {
        status: resp.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await resp.arrayBuffer();

    if (!data || data.byteLength === 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Gitee 返回空数据',
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(data, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file)}`,
        'Content-Length': String(data.byteLength),
        'Cache-Control': 'public, max-age=30',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      ok: false,
      error: '拉取失败: ' + err.message,
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
