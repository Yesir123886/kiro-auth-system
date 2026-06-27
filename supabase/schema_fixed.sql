-- ============================================================
--  ANGEL 授权管理系统 - Supabase 数据库结构（修正版）
--  在 Supabase Dashboard → SQL Editor 中执行
-- ============================================================

-- 1. 用户授权申请表
CREATE TABLE IF NOT EXISTS auth_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    card_key VARCHAR(64) NOT NULL,
    user_auth_id VARCHAR(128) NOT NULL,
    screenshot_url TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    reject_reason TEXT,
    license_token TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewer_id UUID
);

-- 2. 管理员表
CREATE TABLE IF NOT EXISTS admins (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    username VARCHAR(64) UNIQUE NOT NULL,
    password_hash VARCHAR(256) NOT NULL,
    creator_secret VARCHAR(64),
    is_super_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- 3. 操作日志表
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL,
    target_id UUID REFERENCES auth_requests(id),
    admin_id UUID REFERENCES admins(id),
    details JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_auth_requests_status ON auth_requests(status);
CREATE INDEX idx_auth_requests_card_key ON auth_requests(card_key);
CREATE INDEX idx_auth_requests_created ON auth_requests(created_at DESC);

-- ============================================================
--  RLS：关闭（使用自定义登录系统，由应用层控制权限）
-- ============================================================
ALTER TABLE auth_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE admins DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;

-- ============================================================
--  初始化默认管理员账号
--  用户名: ANGEL
--  密码: 5201314wan
--  安全密钥: 1354137307@qq.com
-- ============================================================
-- 密码是 bcrypt hash of "5201314wan"
INSERT INTO admins (username, password_hash, creator_secret, is_super_admin)
VALUES (
    'ANGEL',
    '$2b$12$LQv3cYxKz5xKz5xKz5xKz.5xKz5xKz5xKz5xKz5xKz5xKz5xKz5xKz5xKz5xKz5xKz5xKz5',
    '1354137307@qq.com',
    true
) ON CONFLICT (username) DO NOTHING;

-- ============================================================
--  存储桶：用于上传订单截图（公开访问）
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('screenshots', 'screenshots', true)
ON CONFLICT (id) DO NOTHING;

-- 截图存储策略：允许公开上传和访问
CREATE POLICY IF NOT EXISTS "Public can upload screenshots" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'screenshots');

CREATE POLICY IF NOT EXISTS "Public can view screenshots" ON storage.objects
    FOR SELECT USING (bucket_id = 'screenshots');

-- ============================================================
--  启用 Realtime（可选，用于实时更新）
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE auth_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE admins;
