/**
 * useAuth.ts — Authentication state hook
 *
 * Manages the JWT token lifecycle for the Up_and_Work dashboard:
 *  - Token is stored in localStorage under 'upw_token'
 *  - On mount, verifies the stored token against GET /auth/me
 *  - Exposes: isAuthenticated, isLoading, login(), logout()
 *
 * Usage:
 *   const { isAuthenticated, isLoading, login, logout } = useAuth();
 */

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';

const TOKEN_KEY = 'upw_token';

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  email: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export function useAuth(): AuthState {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);

  /** Attach token to every outgoing request */
  const setAxiosToken = (token: string | null) => {
    if (token) {
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete apiClient.defaults.headers.common['Authorization'];
    }
  };

  /** Verify stored token on mount */
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setIsLoading(false);
      return;
    }
    setAxiosToken(stored);
    apiClient
      .get('/auth/me')
      .then(res => {
        setIsAuthenticated(true);
        setEmail(res.data.email ?? null);
      })
      .catch(() => {
        // Token expired or invalid — clear it
        localStorage.removeItem(TOKEN_KEY);
        setAxiosToken(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (emailInput: string, password: string) => {
    const res = await apiClient.post('/auth/login', { email: emailInput, password });
    const { access_token, email: userEmail } = res.data;
    localStorage.setItem(TOKEN_KEY, access_token);
    setAxiosToken(access_token);
    setEmail(userEmail);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setAxiosToken(null);
    setIsAuthenticated(false);
    setEmail(null);
  }, []);

  return { isAuthenticated, isLoading, email, login, logout };
}
