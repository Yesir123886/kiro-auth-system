-- ============================================================
--  Kiro 授权管理系统 - Supabase 数据库结构
--  在 Supabase Dashboard → SQL Editor 中执行
-- ============================================================

-- 1. 用户授权申请表
CREATE TABLE IF NOT EXISTS auth_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    card_key VARCHAR(64) NOT NULL,              -- 卡密
    user_auth_id VARCHAR(128) NOT NULL,          -- 用户的授权ID
    screenshot_url TEXT,                          -- 订单截图URL（Supabase Storage）
    status VARCHAR(20) DEFAULT 'pending',         -- pending / approved / rejected
    reject_reason TEXT,                           -- 拒绝原因
    license_token TEXT,                           -- 生成的授权令牌
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,                      -- 审批时间
    reviewer_id UUID                              -- 审批管理员ID
);

-- 2. 管理员表
CREATE TABLE IF NOT EXISTS admins (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    username VARCHAR(64) UNIQUE NOT NULL,
    password_hash VARCHAR(256) NOT NULL,          -- bcrypt hash
    creator_secret VARCHAR(64),                   -- hysafe 创建者密钥
    is_super_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- 3. 操作日志表
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL,                  -- request_created / approved / rejected / token_generated
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
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- RLS (Row Level Security) - 安全策略
ALTER TABLE auth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 策略：所有人可以创建申请，管理员可以查看所有
CREATE POLICY "Anyone can view pending/approved requests" ON auth_requests
    FOR SELECT USING (status = 'approved' OR status = 'rejected');

CREATE POLICY "Admins can view all requests" ON auth_requests
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid())
    );

CREATE POLICY "Anyone can create request" ON auth_requests
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Only admins can update" ON auth_requests
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid())
    );

-- 管理员策略：只有超级管理员管理其他管理员
CREATE POLICY "Admins can view all admins" ON admins
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid())
    );

-- 初始化默认管理员（密码: admin123，请部署后立即修改！）
INSERT INTO admins (username, password_hash, creator_secret, is_super_admin)
VALUES ('admin', '$2b$12$LJ3m4k8y/ExampleHashHere', '200810', true)
ON CONFLICT (username) DO NOTHING;

-- 存储桶：用于上传订单截图
INSERT INTO storage.buckets (id, name, public)
VALUES ('screenshots', 'screenshots', false)
ON CONFLICT (id) DO NOTHING;

-- 截图存储策略：已登录用户可上传，管理员可查看
CREATE POLICY "Authenticated users can upload" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'screenshots' AND auth.role() = 'authenticated');

CREATE POLICY "Admins can view screenshots" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'screenshots' AND
        EXISTS (SELECT 1 FROM admins WHERE admins.id = auth.uid())
);
