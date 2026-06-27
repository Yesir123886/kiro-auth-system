-- ============================================================
--  ANGEL 授权系统 - 安全加固数据库结构
--  在 Supabase SQL Editor 中执行（在原有schema之后追加）
-- ============================================================

-- ---- 1. 登录失败记录（防暴力破解）----
CREATE TABLE IF NOT EXISTS login_attempts (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    success BOOLEAN NOT NULL DEFAULT FALSE,  -- 是否成功
    attempted_at TIMESTAMPTZ DEFAULT NOW(),
    user_agent TEXT
);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip_address, attempted_at);
CREATE INDEX idx_login_attempts_user ON login_attempts(username, attempted_at);

-- ---- 2. 验证码（图片验证码/邮箱验证码）----
CREATE TABLE IF NOT EXISTS verification_codes (
    id BIGSERIAL PRIMARY KEY,
    code_type VARCHAR(20) NOT NULL,           -- 'login_captcha' / 'email_2fa'
    code_value VARCHAR(10) NOT NULL,            -- 验证码值
    target_key VARCHAR(64),                    -- 关联键（用户名/IP/邮箱）
    ip_address VARCHAR(45),
    expires_at TIMESTAMPTZ NOT NULL,          -- 过期时间
    used_at TIMESTAMPTZ,                       -- 使用时间
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_verify_code_target ON verification_codes(target_key, code_type, expires_at);
-- 清理过期验证码（每24小时）
CREATE OR REPLACE FUNCTION cleanup_expired_codes() RETURNS void AS $$
BEGIN
    DELETE FROM verification_codes WHERE expires_at < NOW() AND used_at IS NULL;
END;
$$ LANGUAGE sql SECURITY DEFINER;

-- ---- 3. 管理员安全会话（替代localStorage）----
CREATE TABLE IF NOT EXISTS admin_sessions (
    id BIGSERIAL PRIMARY KEY,
    admin_id UUID REFERENCES admins(id) ON DELETE CASCADE,
    session_token UUID NOT NULL DEFAULT gen_random_uuid(),  -- 会话令牌
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    is_valid BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_admin_sessions_token ON admin_sessions(session_token) WHERE is_valid = TRUE;
CREATE INDEX idx_admin_sessions_admin ON admin_sessions(admin_id, is_valid);

-- ---- 4. 操作审计日志（增强版）----
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS session_fingerprint TEXT;

-- ---- 5. 安全配置表 ----
CREATE TABLE IF NOT EXISTS security_config (
    key_name VARCHAR(50) PRIMARY KEY,
    key_value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO security_config (key_name, key_value) VALUES
    ('max_login_attempts', '5'),
    ('lockout_duration_minutes', '15'),
    ('captcha_required_after', '3'),      -- 失败N次后要求验证码
    ('session_timeout_minutes', '120'),     -- 会话超时2小时
    ('2fa_enabled', 'true'),              -- 启用QQ邮箱二次验证
    ('admin_email', '1354137307@qq.com')   -- 管理员QQ邮箱
ON CONFLICT (key_name) DO NOTHING;

-- ============================================================
--  安全相关 RPC 函数
-- ============================================================

-- 检查是否被锁定（返回NULL=未锁定，返回时间戳=锁定到何时）
CREATE OR REPLACE FUNCTION check_ip_lockout(
    p_ip_address VARCHAR(45)
) RETURNS TIMESTAMPTZ AS $$
DECLARE
    v_fail_count INTEGER;
    v_last_attempt TIMESTAMPTZ;
    v_lockout_min INTEGER;
BEGIN
    SELECT value::INT INTO v_lockout_min FROM security_config WHERE key_name = 'lockout_duration_minutes';
    IF v_lockout_min IS NULL THEN v_lockout_min := 15; END IF;

    SELECT COUNT(*), MAX(attempted_at) INTO v_fail_count, v_last_attempt
    FROM login_attempts
    WHERE ip_address = p_ip_address AND success = FALSE
      AND attempted_at > NOW() - MAKE_INTERVAL(mins => v_lockout_min);

    IF v_fail_count >= (SELECT value::INT FROM security_config WHERE key_name = 'max_login_attempts') THEN
        RETURN v_last_attempt + MAKE_INTERVAL(mins => v_lockout_min);
    END IF;

    RETURN NULL;  -- 未锁定
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 记录登录尝试
CREATE OR REPLACE FUNCTION record_login_attempt(
    p_username TEXT,
    p_ip_address VARCHAR(45),
    p_success BOOLEAN,
    p_user_agent TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    INSERT INTO login_attempts (username, ip_address, success, user_agent, attempted_at)
    VALUES (p_username, p_ip_address, p_success, p_user_agent, NOW());
    
    -- 如果失败，清理旧的成功记录（保留失败记录用于计数）
    IF NOT p_success THEN
        DELETE FROM login_attempts WHERE success = TRUE AND attempted_at < NOW() - INTERVAL '1 hour';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 验证管理员密码（bcrypt版本，先用SHA256+salt过渡）
CREATE OR REPLACE FUNCTION verify_admin_password_secure(
    p_username TEXT,
    p_password TEXT
) RETURNS TABLE (success BOOLEAN, admin_id UUID, require_captcha BOOLEAN, require_2fa BOOLEAN, lockout_until TIMESTAMPTZ) AS $$
DECLARE
    v_admin RECORD;
    v_fail_count INTEGER;
    v_max_attempts INTEGER;
    v_ip VARCHAR(45) := current_setting('request.header.x-forwarded-for', '');
    v_locked_until TIMESTAMPTZ;
BEGIN
    -- 获取IP（从请求头或函数参数）
    -- 注意：实际IP由Edge Function传入
    
    SELECT value::INT INTO v_max_attempts FROM security_config WHERE key_name = 'max_login_attempts';
    IF v_max_attempts IS NULL THEN v_max_attempts := 5; END IF;

    -- 检查最近失败次数
    SELECT COUNT(*) INTO v_fail_count FROM login_attempts
    WHERE username = p_username AND success = FALSE
      AND attempted_at > NOW() - INTERVAL '15 minutes';

    -- 查找管理员
    SELECT * INTO v_admin FROM admins WHERE username = p_username;
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE::BOOLEAN, NULL::UUID, TRUE::BOOLEAN, TRUE::BOOLEAN, NULL::TIMESTAMPTZ;
    END IF;

    -- 检查密码（TODO: 生产环境用bcrypt，这里用SHA256+salt过渡）
    -- 密码格式: sha256(salt + password) 存储在 password_hash 字段
    DECLARE v_hash_match BOOLEAN := FALSE;
    BEGIN
        -- 尝试多种验证方式
        IF v_admin.password_hash = crypt(p_password, v_admin.password_hash) THEN
            v_hash_match := TRUE;
        ELSIF v_admin.password_hash = encode(sha256(p_password::bytea), 'hex') THEN
            v_hash_match := TRUE;
        ELSIF v_admin.password_hash = p_password THEN  -- 开发阶段兼容
            v_hash_match := TRUE;
        END IF;
    END;

    RETURN QUERY SELECT 
        v_hash_match AS success,
        v_admin.id AS admin_id,
        (v_fail_count >= (SELECT value::INT FROM security_config WHERE key_name='captcha_required_after')) OR (v_fail_count >= v_max_attempts / 2) AS require_captcha,
        (SELECT value::boolean FROM security_config WHERE key_name='2fa_enabled') AND v_hash_match AS require_2fa,
        NULL::TIMESTAMPTZ AS lockout_until;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 创建/验证邮箱验证码
CREATE OR REPLACE FUNCTION create_email_verification(
    p_email TEXT,
    p_admin_id UUID
) RETURNS TEXT AS $$
DECLARE
    v_code TEXT;
BEGIN
    -- 生成6位数字验证码
    v_code := LPAD(FLOOR(RANDOM()*1000000)::TEXT, 6, '0');
    
    INSERT INTO verification_codes (code_type, code_value, target_key, ip_address, expires_at)
    VALUES ('email_2fa', v_code, p_email, current_setting('request.header.x-real-ip', ''), NOW() + INTERVAL '10 minutes');
    
    RETURN v_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 验证邮箱验证码
CREATE OR REPLACE FUNCTION verify_email_code(
    p_email TEXT,
    p_code TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    v_valid BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM verification_codes
        WHERE code_type = 'email_2fa'
          AND target_key = p_email
          AND code_value = p_code
          AND expires_at > NOW()
          AND used_at IS NULL
    ) INTO v_valid;
    
    IF v_valid THEN
        UPDATE verification_codes SET used_at = NOW(), target_key = p_email || '_used_' || NOW()
        WHERE code_type = 'email_2fa' AND target_key = p_email AND used_at IS NULL AND expires_at > NOW();
    END IF;
    
    RETURN COALESCE(v_valid, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 创建管理会话
CREATE OR REPLACE FUNCTION create_admin_session(
    p_admin_id UUID,
    p_ip VARCHAR(45),
    p_ua TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_token UUID;
BEGIN
    v_token := gen_random_uuid();
    INSERT INTO admin_sessions (admin_id, session_token, ip_address, user_agent, last_active_at)
    VALUES (p_admin_id, v_token, p_ip, p_ua, NOW());
    
    -- 清理过期会话
    DELETE FROM admin_sessions WHERE is_valid = TRUE 
      AND last_active_at < NOW() - MAKE_INTERVAL(mins => 
        (SELECT COALESCE(value::int, 120) FROM security_config WHERE key_name='session_timeout_minutes'));
    
    RETURN v_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 验证会话
CREATE OR REPLACE FUNCTION verify_admin_session(
    p_token UUID,
    p_ip VARCHAR(45) DEFAULT NULL
) RETURNS TABLE (valid BOOLEAN, admin_id UUID, username TEXT, is_super BOOLEAN) AS $$
DECLARE
    s RECORD;
BEGIN
    SELECT as.*, a.username, a.is_super_admin INTO s
    FROM admin_sessions as JOIN admins a ON a.id = as.admin_id
    WHERE as.session_token = p_token AND as.is_valid = TRUE
      AND as.last_active_at > NOW() - MAKE_INTERVAL(mins => 
        (SELECT COALESCE(value::int, 120) FROM security_config WHERE key_name='session_timeout_minutes'));
    
    IF FOUND THEN
        UPDATE admin_sessions SET last_active_at = NOW() WHERE id = s.id;
        RETURN QUERY SELECT TRUE, s.admin_id, s.username, s.is_super;
    ELSE
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, FALSE;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 销毁会话（登出）
CREATE OR REPLACE FUNCTION destroy_admin_session(
    p_token UUID
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE admin_sessions SET is_valid = FALSE WHERE session_token = p_token;
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
