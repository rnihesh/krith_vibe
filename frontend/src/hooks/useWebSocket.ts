/* ─── WebSocket hook for real-time updates ─── */
import { useEffect, useRef, useState, useCallback } from "react";
import { WSEvent } from "../types";

const WS_URL = `ws://${window.location.hostname}:8484/ws`;
const RECONNECT_DELAY = 2000;

export function useWebSocket(onEvent: (event: WSEvent) => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
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
        console.log("[WS] Disconnected, reconnecting...");
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
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
