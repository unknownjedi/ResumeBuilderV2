import { getSqlite } from "@/server/db/client";
import {
  getLatestEventId,
  getOldestEventId,
  listEventsAfter,
  type TaskEvent,
} from "@/server/events/task-events";
import { logger } from "@/server/logging/logger";
import { validateHostAndOrigin } from "@/server/security/host-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 750;
const HEARTBEAT_INTERVAL_MS = 15_000;

function formatSseMessage(
  eventName: string,
  data: unknown,
  id?: number
): string {
  const lines: string[] = [];
  if (id !== undefined) {
    lines.push(`id: ${id}`);
  }
  lines.push(`event: ${eventName}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join("\n")}\n\n`;
}

export async function GET(req: Request): Promise<Response> {
  const hostCheck = validateHostAndOrigin(req);
  if (!hostCheck.ok) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: hostCheck.code, message: hostCheck.message },
      }),
      {
        status: hostCheck.status,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const sqlite = getSqlite();
  const encoder = new TextEncoder();
  const rawLastEventId = req.headers.get("last-event-id")?.trim();

  let pollTimer: NodeJS.Timeout | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        req.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          // Stream already closed
        }
      };

      const onAbort = () => {
        cleanup();
      };

      req.signal.addEventListener("abort", onAbort, { once: true });

      const enqueueText = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const latestId = getLatestEventId(sqlite);
      const oldestId = getOldestEventId(sqlite);
      let cursor = latestId;

      if (rawLastEventId !== undefined && rawLastEventId !== "") {
        const parsedId = Number(rawLastEventId);
        const isInvalidCursor =
          !Number.isInteger(parsedId) ||
          parsedId < 0 ||
          parsedId > latestId ||
          (oldestId !== null && parsedId < oldestId - 1) ||
          (oldestId === null && parsedId < latestId);

        if (isInvalidCursor) {
          cursor = latestId;
          enqueueText(
            formatSseMessage(
              "reset",
              { cursor: latestId, reason: "cursor_pruned" },
              latestId
            )
          );
        } else {
          cursor = parsedId;
          const missed = listEventsAfter(sqlite, cursor, 500);
          for (const ev of missed) {
            enqueueText(formatSseMessage(ev.eventType, ev, ev.id));
            cursor = ev.id;
          }
          enqueueText(
            formatSseMessage("ready", { cursor }, cursor)
          );
        }
      } else {
        cursor = latestId;
        enqueueText(formatSseMessage("ready", { cursor: latestId }, latestId));
      }

      let polling = false;
      pollTimer = setInterval(() => {
        if (closed || polling) return;
        polling = true;
        try {
          const events: TaskEvent[] = listEventsAfter(sqlite, cursor, 200);
          for (const ev of events) {
            enqueueText(formatSseMessage(ev.eventType, ev, ev.id));
            cursor = ev.id;
          }
        } catch (err) {
          logger.warn("sse.poll_error", "Error polling task_events stream.", {
            errorCode: "SSE_POLL_ERROR",
            meta: { reason: err instanceof Error ? err.message : "unknown" },
          });
        } finally {
          polling = false;
        }
      }, POLL_INTERVAL_MS);

      heartbeatTimer = setInterval(() => {
        enqueueText(": heartbeat\n\n");
      }, HEARTBEAT_INTERVAL_MS);

      if (req.signal.aborted) {
        cleanup();
      }
    },
    cancel() {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
