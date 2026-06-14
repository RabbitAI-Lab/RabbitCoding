/**
 * AuthProvider Context
 *
 * 管理 Casdoor OAuth 2.0 Authorization Code + PKCE 登录状态。
 * - 持久化用户信息到 localStorage
 * - 监听 deep-link 回调
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
import { openUrl } from '@tauri-apps/plugin-opener';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { useLocalStorage } from './useLocalStorage';
import type { CasdoorUser } from '../types';

// ============================================================
// 常量
// ============================================================

const CASDOOR_BASE_URL = 'https://auth.rabbitai-lab.com';
const CASDOOR_CLIENT_ID = '1a2b435570a36765109d';
const REDIRECT_URI = 'rabbitcoding://auth/callback';
const SCOPES = 'openid profile email';
const STORAGE_KEY = 'casdoor-user';
// PKCE 数据用 localStorage 而非 sessionStorage
// 因为 deep-link 回调可能唤起新进程实例，sessionStorage 无法跨进程共享
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

  // ---- 深链接监听 ----
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    async function setup() {
      // 处理深链接回调
      const handleCallback = async (urls: string[]) => {
        for (const urlStr of urls) {
          if (!urlStr.startsWith('rabbitcoding://auth/callback')) continue;

          try {
            const url = new URL(urlStr);
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');

            if (!code) {
              setLoginError('Authorization callback missing code');
              setIsLoggingIn(false);
              pendingRef.current = false;
              continue;
            }

            // 验证 state（防 CSRF）— 从 localStorage 读取（跨进程）
            const savedState = localStorage.getItem(PKCE_STATE_KEY);
            if (state !== savedState) {
              console.warn('[auth] state mismatch:', { state, savedState });
              setLoginError('State mismatch — possible CSRF attack');
              setIsLoggingIn(false);
              pendingRef.current = false;
              continue;
            }

            // 取出 code_verifier — 从 localStorage 读取
            const codeVerifier = localStorage.getItem(PKCE_VERIFIER_KEY);
            if (!codeVerifier) {
              setLoginError('Missing code_verifier — session may have expired');
              setIsLoggingIn(false);
              pendingRef.current = false;
              continue;
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
        }
      };

      // 1. 注册 onOpenUrl 监听器（应用运行中收到深链接）
      try {
        unlisten = await onOpenUrl((urls) => {
          void handleCallback(urls);
        });
      } catch (err) {
        console.warn('[auth] onOpenUrl setup failed:', err);
      }

      // 2. 检查 getCurrent（应用通过深链接启动）
      try {
        const currentUrls = await getCurrent();
        if (currentUrls && currentUrls.length > 0) {
          await handleCallback(currentUrls);
        }
      } catch (err) {
        // getCurrent 失败不致命，可能在某些平台不支持
        console.warn('[auth] getCurrent failed:', err);
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

      // 2. 存储到 localStorage（跨进程共享，deep-link 可能唤起新实例）
      localStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
      localStorage.setItem(PKCE_STATE_KEY, state);

      // 3. 构建授权 URL
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
