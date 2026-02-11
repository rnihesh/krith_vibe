/* ─── WebSocket hook with exponential backoff reconnection ─── */
import { useEffect, useRef, useState, useCallback } from "react";
import { WSEvent } from "../types";
import { WS_BASE } from "../api";

const WS_URL = `${WS_BASE}/ws`;

const BACKOFF_BASE = 1000;
const BACKOFF_MAX = 30000;
const BACKOFF_MULTIPLIER = 2;

export function useWebSocket(onEvent: (event: WSEvent) => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retryCount = useRef(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryCount.current = 0;
        console.log("[WS] Connected");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WSEvent;
          onEventRef.current(data);
        } catch (e) {
          console.warn("[WS] Bad message:", event.data);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        const delay = Math.min(
          BACKOFF_BASE * Math.pow(BACKOFF_MULTIPLIER, retryCount.current),
          BACKOFF_MAX,
        );
        retryCount.current++;
        console.log(
          `[WS] Disconnected, reconnecting in ${Math.round(delay / 1000)}s...`,
        );
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      const delay = Math.min(
        BACKOFF_BASE * Math.pow(BACKOFF_MULTIPLIER, retryCount.current),
        BACKOFF_MAX,
      );
      retryCount.current++;
      reconnectTimer.current = setTimeout(connect, delay);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { connected, send };
}
