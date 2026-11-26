"use client";

import * as React from "react";

export type TaskEventType =
  | "task.queued"
  | "task.started"
  | "task.progress"
  | "task.succeeded"
  | "task.failed"
  | "task.cancelled"
  | "resource.updated";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface TaskEvent {
  id: number;
  taskId: string;
  taskType: string;
  eventType: TaskEventType;
  status: TaskStatus;
  progressStage?: string;
  progressPercent?: number;
  resourceType?: "job" | "resume" | "application" | "source";
  resourceId?: string;
  occurredAt: string;
}

export type SseConnectionState = "connected" | "reconnecting" | "paused";

export type LiveEventMessage =
  | { kind: "event"; event: TaskEvent }
  | { kind: "reset"; cursor: number }
  | { kind: "poll" };

type ChannelMessage =
  | {
      type: "heartbeat";
      leaderId: string;
      timestamp: number;
      connectionState: SseConnectionState;
    }
  | { type: "claim"; candidateId: string; timestamp: number }
  | { type: "resign"; leaderId: string }
  | { type: "state"; leaderId: string; connectionState: SseConnectionState }
  | { type: "event"; leaderId: string; payload: TaskEvent }
  | { type: "reset"; leaderId: string; cursor: number };

const CHANNEL_NAME = "pjc-live-events";
const HEARTBEAT_INTERVAL_MS = 2000;
const LEASE_TIMEOUT_MS = 5000;
const DISCONNECT_PAUSE_MS = 30000;
const FALLBACK_POLL_INTERVAL_MS = 30000;

const KNOWN_EVENT_TYPES = new Set<TaskEventType>([
  "task.queued",
  "task.started",
  "task.progress",
  "task.succeeded",
  "task.failed",
  "task.cancelled",
  "resource.updated",
]);

function createTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseTaskEvent(raw: string): TaskEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.id !== "number" ||
      typeof candidate.taskId !== "string" ||
      typeof candidate.taskType !== "string" ||
      typeof candidate.eventType !== "string" ||
      typeof candidate.status !== "string" ||
      typeof candidate.occurredAt !== "string"
    ) {
      return null;
    }
    if (!KNOWN_EVENT_TYPES.has(candidate.eventType as TaskEventType)) {
      return null;
    }
    return candidate as unknown as TaskEvent;
  } catch {
    return null;
  }
}

export interface SseContextValue {
  connectionState: SseConnectionState;
  isLeader: boolean;
  broadcastUnavailable: boolean;
  lastEvent: TaskEvent | null;
  subscribe: (listener: (message: LiveEventMessage) => void) => () => void;
}

const SseContext = React.createContext<SseContextValue | null>(null);

const emptySubscribe = () => () => {};

/**
 * Coordinates a single leader-tab EventSource('/api/events') across tabs using
 * BroadcastChannel('pjc-live-events') with deterministic failover and 30s fallback polling when paused.
 */
export function SseProvider({ children }: { children: React.ReactNode }) {
  const [connectionState, setConnectionState] =
    React.useState<SseConnectionState>("reconnecting");
  const [isLeader, setIsLeader] = React.useState(false);
  const broadcastUnavailable = React.useSyncExternalStore(
    emptySubscribe,
    () => typeof BroadcastChannel === "undefined",
    () => false
  );
  const [lastEvent, setLastEvent] = React.useState<TaskEvent | null>(null);

  const listenersRef = React.useRef(new Set<(message: LiveEventMessage) => void>());

  const emitToSubscribers = React.useCallback((message: LiveEventMessage) => {
    if (message.kind === "event") {
      setLastEvent(message.event);
    }
    for (const listener of listenersRef.current) {
      try {
        listener(message);
      } catch {
        // Subscriber errors must not interrupt live event delivery.
      }
    }
  }, []);

  const subscribe = React.useCallback(
    (listener: (message: LiveEventMessage) => void) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
    []
  );

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const tabId = createTabId();
    const hasBroadcastChannel = typeof BroadcastChannel !== "undefined";

    const channel = hasBroadcastChannel ? new BroadcastChannel(CHANNEL_NAME) : null;

    let disposed = false;
    let leaderActive = false;
    let currentLeaderId: string | null = null;
    let lastLeaderHeartbeat = 0;
    let currentState: SseConnectionState = "reconnecting";
    let eventSource: EventSource | null = null;

    let electionTimer: ReturnType<typeof setTimeout> | null = null;
    let confirmClaimTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let leaseMonitorTimer: ReturnType<typeof setInterval> | null = null;
    let disconnectPauseTimer: ReturnType<typeof setTimeout> | null = null;

    const postChannel = (msg: ChannelMessage) => {
      try {
        channel?.postMessage(msg);
      } catch {
        // Ignore closed channel races during unload.
      }
    };

    const setLeaderState = (next: SseConnectionState) => {
      currentState = next;
      setConnectionState(next);
      if (leaderActive) {
        postChannel({ type: "state", leaderId: tabId, connectionState: next });
      }
    };

    const clearDisconnectTimer = () => {
      if (disconnectPauseTimer !== null) {
        clearTimeout(disconnectPauseTimer);
        disconnectPauseTimer = null;
      }
    };

    const closeEventSource = () => {
      clearDisconnectTimer();
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };

    const relinquishLeadership = () => {
      if (!leaderActive) {
        return;
      }
      leaderActive = false;
      setIsLeader(false);
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      closeEventSource();
    };

    const openLeaderEventSource = () => {
      closeEventSource();
      if (disposed || typeof EventSource === "undefined") {
        setLeaderState("paused");
        return;
      }

      setLeaderState("reconnecting");
      disconnectPauseTimer = setTimeout(() => {
        if (!disposed && leaderActive) {
          setLeaderState("paused");
        }
      }, DISCONNECT_PAUSE_MS);

      const source = new EventSource("/api/events");
      eventSource = source;

      const markConnected = () => {
        if (disposed || !leaderActive) return;
        clearDisconnectTimer();
        if (currentState !== "connected") {
          setLeaderState("connected");
        }
      };

      source.onopen = () => {
        markConnected();
      };

      source.addEventListener("ready", () => {
        markConnected();
      });

      source.addEventListener("reset", (ev) => {
        markConnected();
        let cursor = 0;
        try {
          const data = JSON.parse((ev as MessageEvent<string>).data) as {
            cursor?: unknown;
          };
          if (typeof data?.cursor === "number") {
            cursor = data.cursor;
          }
        } catch {
          cursor = 0;
        }
        emitToSubscribers({ kind: "reset", cursor });
        postChannel({ type: "reset", leaderId: tabId, cursor });
      });

      const handleRawTaskEvent = (raw: string) => {
        markConnected();
        const taskEvent = parseTaskEvent(raw);
        if (!taskEvent) {
          return;
        }
        emitToSubscribers({ kind: "event", event: taskEvent });
        postChannel({ type: "event", leaderId: tabId, payload: taskEvent });
      };

      for (const eventType of KNOWN_EVENT_TYPES) {
        source.addEventListener(eventType, (ev) => {
          handleRawTaskEvent((ev as MessageEvent<string>).data);
        });
      }

      source.onmessage = (ev) => {
        handleRawTaskEvent(ev.data);
      };

      source.onerror = () => {
        if (disposed || !leaderActive) return;
        if (currentState === "connected") {
          setLeaderState("reconnecting");
        }
        if (disconnectPauseTimer === null && currentState !== "paused") {
          disconnectPauseTimer = setTimeout(() => {
            if (!disposed && leaderActive) {
              setLeaderState("paused");
            }
          }, DISCONNECT_PAUSE_MS);
        }
      };
    };

    const becomeLeader = () => {
      if (disposed || leaderActive) {
        return;
      }
      leaderActive = true;
      currentLeaderId = tabId;
      lastLeaderHeartbeat = Date.now();
      setIsLeader(true);
      openLeaderEventSource();

      if (channel) {
        postChannel({
          type: "heartbeat",
          leaderId: tabId,
          timestamp: Date.now(),
          connectionState: currentState,
        });
        heartbeatTimer = setInterval(() => {
          if (!disposed && leaderActive) {
            postChannel({
              type: "heartbeat",
              leaderId: tabId,
              timestamp: Date.now(),
              connectionState: currentState,
            });
          }
        }, HEARTBEAT_INTERVAL_MS);
      }
    };

    const scheduleElection = (delayMs?: number) => {
      if (disposed || leaderActive) return;
      if (!channel) {
        becomeLeader();
        return;
      }
      if (electionTimer !== null) {
        clearTimeout(electionTimer);
      }
      const jitter = delayMs ?? 140 + Math.floor(Math.random() * 140);
      electionTimer = setTimeout(() => {
        electionTimer = null;
        if (disposed || leaderActive) return;
        const leaderAlive =
          currentLeaderId !== null &&
          Date.now() - lastLeaderHeartbeat < LEASE_TIMEOUT_MS;
        if (leaderAlive) return;

        postChannel({
          type: "claim",
          candidateId: tabId,
          timestamp: Date.now(),
        });
        if (confirmClaimTimer !== null) {
          clearTimeout(confirmClaimTimer);
        }
        confirmClaimTimer = setTimeout(() => {
          confirmClaimTimer = null;
          if (disposed || leaderActive) return;
          const stillNoLeader =
            currentLeaderId === null ||
            Date.now() - lastLeaderHeartbeat >= LEASE_TIMEOUT_MS;
          if (stillNoLeader) {
            becomeLeader();
          }
        }, 90);
      }, jitter);
    };

    if (channel) {
      channel.onmessage = (ev: MessageEvent<ChannelMessage>) => {
        const msg = ev.data;
        if (!msg || typeof msg !== "object") return;

        switch (msg.type) {
          case "heartbeat": {
            if (msg.leaderId === tabId) return;
            if (leaderActive && msg.leaderId < tabId) {
              relinquishLeadership();
            }
            if (!leaderActive) {
              currentLeaderId = msg.leaderId;
              lastLeaderHeartbeat = Date.now();
              currentState = msg.connectionState;
              setConnectionState(msg.connectionState);
            }
            break;
          }
          case "claim": {
            if (msg.candidateId === tabId) return;
            if (leaderActive) {
              if (msg.candidateId < tabId) {
                relinquishLeadership();
                currentLeaderId = msg.candidateId;
                lastLeaderHeartbeat = Date.now();
              } else {
                postChannel({
                  type: "heartbeat",
                  leaderId: tabId,
                  timestamp: Date.now(),
                  connectionState: currentState,
                });
              }
            } else if (msg.candidateId < tabId && confirmClaimTimer !== null) {
              clearTimeout(confirmClaimTimer);
              confirmClaimTimer = null;
            }
            break;
          }
          case "resign": {
            if (msg.leaderId === currentLeaderId) {
              currentLeaderId = null;
              lastLeaderHeartbeat = 0;
              scheduleElection(40 + Math.floor(Math.random() * 100));
            }
            break;
          }
          case "state": {
            if (!leaderActive && msg.leaderId === currentLeaderId) {
              lastLeaderHeartbeat = Date.now();
              currentState = msg.connectionState;
              setConnectionState(msg.connectionState);
            }
            break;
          }
          case "event": {
            if (!leaderActive) {
              lastLeaderHeartbeat = Date.now();
              emitToSubscribers({ kind: "event", event: msg.payload });
            }
            break;
          }
          case "reset": {
            if (!leaderActive) {
              lastLeaderHeartbeat = Date.now();
              emitToSubscribers({ kind: "reset", cursor: msg.cursor });
            }
            break;
          }
        }
      };

      leaseMonitorTimer = setInterval(() => {
        if (!disposed && !leaderActive) {
          if (
            currentLeaderId === null ||
            Date.now() - lastLeaderHeartbeat > LEASE_TIMEOUT_MS
          ) {
            currentLeaderId = null;
            scheduleElection();
          }
        }
      }, HEARTBEAT_INTERVAL_MS);
    }

    const handleBeforeUnload = () => {
      if (leaderActive) {
        postChannel({ type: "resign", leaderId: tabId });
        closeEventSource();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);

    scheduleElection();

    return () => {
      disposed = true;
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
      if (electionTimer !== null) clearTimeout(electionTimer);
      if (confirmClaimTimer !== null) clearTimeout(confirmClaimTimer);
      if (leaseMonitorTimer !== null) clearInterval(leaseMonitorTimer);
      if (leaderActive) {
        postChannel({ type: "resign", leaderId: tabId });
      }
      relinquishLeadership();
      channel?.close();
    };
  }, [emitToSubscribers]);

  // Bounded 30s fallback polling when SSE remains disconnected >30s ("paused").
  React.useEffect(() => {
    if (connectionState !== "paused") {
      return;
    }

    const timer = setInterval(() => {
      emitToSubscribers({ kind: "poll" });
    }, FALLBACK_POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [connectionState, emitToSubscribers]);

  const value = React.useMemo<SseContextValue>(
    () => ({
      connectionState,
      isLeader,
      broadcastUnavailable,
      lastEvent,
      subscribe,
    }),
    [broadcastUnavailable, connectionState, isLeader, lastEvent, subscribe]
  );

  return <SseContext.Provider value={value}>{children}</SseContext.Provider>;
}

/** Access live SSE connection status and subscribe to task/resource invalidation events. */
export function useSse(): SseContextValue {
  const ctx = React.useContext(SseContext);
  if (!ctx) {
    throw new Error("useSse must be used within SseProvider");
  }
  return ctx;
}
