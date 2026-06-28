/**
 * AuthProvider Context
 *
 * 管理 Casdoor OAuth 2.0 Authorization Code + PKCE 登录状态。
 * - 持久化用户信息到 localStorage
 * - 通过本地 loopback HTTP 回调（Rust 端 start_auth_callback_server 发出的 'auth-callback' 事件）接收授权码
 * - 提供 login / logout 方法
 *
 * 参考 ThemeProvider 的 Context 模式。
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useLocalStorage } from './useLocalStorage';
import type { CasdoorUser } from '../types';

// ============================================================
// 常量
// ============================================================

const CASDOOR_BASE_URL = 'https://auth.rabbitai-lab.com';
const CASDOOR_CLIENT_ID = '1a2b435570a36765109d';
// OAuth 走 loopback HTTP 回调（http://127.0.0.1:17331/callback），由 Rust 端 start_auth_callback_server 监听。
// 无需自定义 scheme / .app bundle，tauri dev 与生产 .app 行为一致（须与 auth.rs 的 AUTH_CALLBACK_PORT 一致）。
const REDIRECT_URI = 'http://127.0.0.1:17331/callback';
const SCOPES = 'openid profile email';
const STORAGE_KEY = 'casdoor-user';
// PKCE 数据用 localStorage 而非 sessionStorage
const PKCE_VERIFIER_KEY = 'casdoor-pkce-verifier';
const PKCE_STATE_KEY = 'casdoor-pkce-state';

// ============================================================
// 类型定义
// ============================================================

interface AuthContextValue {
  /** 当前登录用户（null = 未登录） */
  user: CasdoorUser | null;
  /** 是否正在登录流程中 */
  isLoggingIn: boolean;
  /** 登录错误信息 */
  loginError: string | null;
  /** 发起登录 */
  login: () => Promise<void>;
  /** 退出登录 */
  logout: () => void;
}

// ============================================================
// PKCE 辅助函数
// ============================================================

/**
 * 生成随机字符串作为 code_verifier（43-128 字符）
 */
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join('');
}

/**
 * 计算 code_challenge = base64url(SHA256(verifier))，去除 padding
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  // base64url 编码
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ============================================================
// Context
// ============================================================

const AuthContext = createContext<AuthContextValue | null>(null);

// ============================================================
// Provider
// ============================================================

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useLocalStorage<CasdoorUser | null>(STORAGE_KEY, null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const pendingRef = useRef<boolean>(false);

  // ---- 监听 loopback 回调（Rust 端 start_auth_callback_server 发出 'auth-callback' 事件）----
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function setup() {
      // 处理 loopback 回调：code/state 由 Rust 回调服务从 URL query 解析后通过事件传入
      const handleCallback = async (code: string | null, state: string | null) => {
        try {
          if (!code) {
            setLoginError('Authorization callback missing code');
            setIsLoggingIn(false);
            pendingRef.current = false;
            return;
          }

          // 验证 state（防 CSRF）— 从 localStorage 读取
          const savedState = localStorage.getItem(PKCE_STATE_KEY);
          if (state !== savedState) {
            console.warn('[auth] state mismatch:', { state, savedState });
            setLoginError('State mismatch — possible CSRF attack');
            setIsLoggingIn(false);
            pendingRef.current = false;
            return;
          }

          // 取出 code_verifier — 从 localStorage 读取
          const codeVerifier = localStorage.getItem(PKCE_VERIFIER_KEY);
          if (!codeVerifier) {
            setLoginError('Missing code_verifier — session may have expired');
            setIsLoggingIn(false);
            pendingRef.current = false;
            return;
          }

          // 清理 PKCE 临时数据
          localStorage.removeItem(PKCE_VERIFIER_KEY);
          localStorage.removeItem(PKCE_STATE_KEY);

          // 调用 Rust 完成 token 交换 + userinfo 获取
          const result = await invoke<{
            accessToken: string;
            username: string;
            displayName: string;
            email: string;
            avatar: string;
          }>('casdoor_complete_login', {
            code,
            codeVerifier,
          });

          const userWithTimestamp: CasdoorUser = {
            username: result.username,
            displayName: result.displayName,
            email: result.email,
            avatar: result.avatar,
            accessToken: result.accessToken,
            loggedInAt: Date.now(),
          };

          setUser(userWithTimestamp);
          setLoginError(null);
        } catch (err) {
          console.error('[auth] login callback error:', err);
          setLoginError(err instanceof Error ? err.message : String(err));
        } finally {
          setIsLoggingIn(false);
          pendingRef.current = false;
        }
      };

      try {
        unlisten = await listen<{ code: string; state: string | null }>(
          'auth-callback',
          (event) => {
            void handleCallback(event.payload.code, event.payload.state);
          },
        );
      } catch (err) {
        console.warn('[auth] auth-callback event listen failed:', err);
      }
    }

    void setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [setUser]);

  // ---- 登录方法 ----
  const login = useCallback(async () => {
    if (pendingRef.current || isLoggingIn) return;
    pendingRef.current = true;
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      // 1. 生成 PKCE
      const codeVerifier = generateRandomString(64);
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const state = generateRandomString(32);

      // 2. 存储到 localStorage（loopback 回调命中本地服务，同一进程内）
      localStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
      localStorage.setItem(PKCE_STATE_KEY, state);

      // 3. 构建授权 URL（redirect_uri 指向本地 loopback 回调服务）
      const authUrl = new URL(`${CASDOOR_BASE_URL}/login/oauth/authorize`);
      authUrl.searchParams.set('client_id', CASDOOR_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', SCOPES);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('state', state);

      // 4. 打开浏览器
      await openUrl(authUrl.toString());
    } catch (err) {
      console.error('[auth] login error:', err);
      setLoginError(err instanceof Error ? err.message : String(err));
      setIsLoggingIn(false);
      pendingRef.current = false;
    }
  }, [isLoggingIn]);

  // ---- 退出登录 ----
  const logout = useCallback(() => {
    setUser(null);
    setLoginError(null);
    localStorage.removeItem(PKCE_VERIFIER_KEY);
    localStorage.removeItem(PKCE_STATE_KEY);
    // 清除缓存的 AI 转发 Key，避免跨账号串用
    localStorage.removeItem('ai-forwarding-key');
    localStorage.removeItem('ai-forwarding-key-prefix');
  }, [setUser]);

  return (
    <AuthContext.Provider
      value={{ user, isLoggingIn, loginError, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ============================================================
// 消费 Hook
// ============================================================

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
