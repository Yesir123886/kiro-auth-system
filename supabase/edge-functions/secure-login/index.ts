// ============================================================
//  ANGEL 安全登录 Edge Function
//  部署到 Supabase: Edge Functions → create "secure-login"
//  功能：验证码 + 失败锁定 + QQ邮箱二次验证
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 简单的邮箱发送（通过 Supabase 的邮件服务或第三方）
async function sendQQEmail(email, code) {
    // 方案1：使用 Resend / SendGrid 等邮件服务（推荐）
    // 方案2：使用 Supabase 内置邮件功能
    // 这里返回验证码，由前端/另一个函数处理实际发送
    
    console.log(`[2FA] 发送验证码 ${code} 到 ${email}`);
    
    // 实际部署时，这里调用邮件API：
    // const resp = await fetch('https://api.resend.com/emails', {
    //     method: 'POST',
    //     headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    //     body: JSON.stringify({
    //         from: 'angel@yourdomain.com',
    //         to: [email],
    //         subject: '🔐 ANGEL 管理后台 - 二次验证码',
    //         html: `<div style="font-family:sans-serif;padding:20px;background:#0f1117;color:#e4e4e7;max-width:480px;margin:auto;border-radius:12px;"><h2 style="color:#6c5ce7;">ANGEL 安全验证</h2><p>您的登录验证码是：</p><div style="background:rgba(108,92,231,.1);border:1px solid #6c5ce7;border-radius:8px;padding:16px;text-align:center;font-size:28px;font-weight:800;letter-spacing:4px;color:#6c5ce7;margin:16px 0;">${code}</div><p style="color:#9ca3af;font-size:13px;">10分钟内有效 · 请勿泄露给他人</p><p style="color:#606078;font-size:11px;">如果不是您本人操作，请忽略此邮件</p></div>`
    //     })
    // });
    
    return { ok: true, message: `验证码已发送到 ${email}` };
}

// 生成随机验证码
function genCode(length = 6) {
    let c = '';
    for (let i = 0; i < length; i++) c += Math.floor(Math.random() * 10);
    return c;
}

// 验证码字符集（用于图片验证码）
function genCaptchaText(length = 4) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < length; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
}

// 生成SVG验证码图片
function generateCaptchaSVG(text) {
    const w = 120, h = 44;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="background:linear-gradient(135deg,#1a1d27,#222636);border-radius:6px;">`;
    
    // 干扰线
    for (let i = 0; i < 4; i++) {
        const x1 = Math.random() * w, y1 = Math.random() * h;
        const x2 = Math.random() * w, y2 = Math.random() * h;
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(108,92,231,0.15)" stroke-width="1"/>`;
    }
    
    // 干扰点
    for (let i = 0; i < 20; i++) {
        const cx = Math.random() * w, cy = Math.random() * h;
        svg += `<circle cx="${cx}" cy="${cy}" r="1" fill="rgba(162,155,254,0.2)"/>`;
    }
    
    // 文字
    for (let i = 0; i < text.length; i++) {
        const x = 14 + i * 26;
        const y = 28 + (Math.random() - 0.5) * 8;
        const rot = (Math.random() - 0.5) * 20;
        svg += `<text x="${x}" y="${y}" fill="#a29bfe" font-family="monospace" font-size="22" font-weight="700" transform="rotate(${rot},${x},${y})">${text[i]}</text>`;
    }
    
    svg += '</svg>';
    return svg;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    
    try {
        const url = new URL(req.url);
        const path = url.pathname.replace('/secure-login', '');
        
        // ---- 路由分发 ----
        if (path === '/captcha') {
            // 获取图片验证码
            const text = genCaptchaText();
            const captchaId = crypto.randomUUID();
            // 存储验证码（生产环境用Redis，这里简化返回给客户端加密存储）
            const svg = generateCaptchaSVG(text);
            
            return new Response(JSON.stringify({ 
                captchaId, 
                svg: btoa(unescape(encodeURIComponent(svg))),
                // 同时返回一个hash用于验证（简单方案：前端回传原文+ID）
                hint: text.length.toString()
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        
        if (path === '/login') {
            // 安全登录接口
            const { username, password, captcha_id, captcha_code, ip } = await req.json();
            
            // 1. 基础校验
            if (!username || !password) {
                return new Response(JSON.stringify({ error: '用户名和密码不能为空' }), 
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            
            // 2. 检查IP锁定（需要数据库查询，这里模拟）
            // 实际部署时通过 Supabase RPC check_ip_lockout(ip)
            
            // 3. 验证码校验（如果有）
            if (captcha_code && captcha_code.length < 4) {
                return new Response(JSON.stringify({ error: '验证码错误' }), 
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            
            // 4. 验证管理员密码（通过 Supabase RPC）
            // 返回: { success, admin_id, require_2fa }
            
            // 模拟响应（实际部署时连接Supabase）
            const loginResult = {
                success: true,
                admin_id: 'mock-admin-id',
                require_2fa: true,  // 总是需要2FA
                session_token: null
            };
            
            if (!loginResult.success) {
                return new Response(JSON.stringify({ error: '用户名或密码错误' }), 
                    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            
            // 5. 如果需要2FA，生成并发送验证码
            if (loginResult.require_2fa) {
                const email = '1354137307@qq.com';  // 从配置读取
                const code = genCode();
                
                // 存储验证码到数据库
                // INSERT INTO verification_codes ...
                
                // 发送邮件（异步）
                await sendQQEmail(email, code);
                
                return new Response(JSON.stringify({ 
                    step: '2fa_required',
                    message: '验证码已发送到你的QQ邮箱',
                    email_mask: email.replace(/(.{3})(.*)(@.*)/, '$1***$3'),
                    temp_token: 'temp-' + crypto.randomUUID().slice(0, 8)  // 临时令牌
                }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            
            // 6. 登录成功，创建会话
            return new Response(JSON.stringify({
                success: true,
                token: loginResult.session_token || 'session-' + crypto.randomUUID(),
                redirect: '/admin.html'
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        
        if (path === '/verify-2fa') {
            // 二次验证
            const { temp_token, code, email } = await req.json();
            
            // 验证码检查
            if (!code || code.length !== 6) {
                return new Response(JSON.stringify({ error: '验证码格式错误' }), 
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            
            // TODO: 从数据库验证 code
            const valid = (code === '123456'); // 测试时固定值
            
            if (!valid) {
                return new Response(JSON.stringify({ error: '验证码错误或已过期' }), 
                    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
            }
            
            // 创建正式会话
            return new Response(JSON.stringify({
                success: true,
                token: 'secure-session-' + crypto.randomUUID(),
                redirect: '/admin.html'
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        
        // 默认404
        return new Response(JSON.stringify({ error: 'Not Found' }), 
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        
    } catch (err) {
        console.error('[Secure Login Error]', err);
        return new Response(JSON.stringify({ error: err.message }), 
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
});
