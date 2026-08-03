import { useEffect, useRef, useCallback } from 'react';

export function useWebSocket(url: string, onMessage: (data: Record<string, unknown>) => void) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountedRef = useRef(false);

  const connect = useCallback(() => {
    if (!url || isUnmountedRef.current) return;

    try {
      ws.current = new WebSocket(url);

      ws.current.onmessage = (e) => {
        if (isUnmountedRef.current) return;
        try {
          const data = JSON.parse(e.data);
          onMessage(data);
        } catch {
          onMessage(e.data);
        }
      };

      ws.current.onclose = () => {
        if (isUnmountedRef.current) return;
        // Schedule auto-reconnect if not intentionally unmounted
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      ws.current.onerror = () => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.close();
        }
      };
    } catch (err) {
      console.warn('WebSocket connection error:', err);
    }
  }, [url, onMessage]);

  useEffect(() => {
    isUnmountedRef.current = false;
    connect();

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (ws.current) {
        ws.current.onclose = null; // Suppress onclose callback during unmount
        ws.current.onerror = null;
        if (ws.current.readyState === WebSocket.OPEN || ws.current.readyState === WebSocket.CONNECTING) {
          ws.current.close();
        }
      }
    };
  }, [connect]);

  const sendMessage = useCallback((msg: string | object) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      if (typeof msg === 'string') {
        ws.current.send(msg);
      } else {
        ws.current.send(JSON.stringify(msg));
      }
    }
  }, []);

  return { sendMessage };
}
