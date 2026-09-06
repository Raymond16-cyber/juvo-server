import crypto from "crypto";
import EventEmitter from "events";
import WebSocket from "ws";
import {
  brokerError,
  brokerLog,
  brokerWarn,
  redactSecret,
} from "../../utils/brokerDebug.js";
import {
  CTRADER_JSON_ENDPOINT,
  CTRADER_PAYLOAD_TYPES,
  CTRADER_SOCKET_TIMEOUT_MS,
} from "./ctrader.constants.js";

function safeSocketError(error) {
  return {
    name: error?.name,
    message: error?.message,
    code: error?.code,
    errno: error?.errno,
    syscall: error?.syscall,
    host: error?.host,
    hostname: error?.hostname,
    address: error?.address,
    port: error?.port,
  };
}

function safePayload(payload = {}) {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.includes("token") ||
        normalizedKey.includes("secret") ||
        normalizedKey.includes("code") ||
        normalizedKey === "clientid"
      ) {
        return [key, redactSecret(value)];
      }

      return [key, value];
    }),
  );
}

function safeMessageSummary(message) {
  return {
    clientMsgId: message?.clientMsgId || null,
    payloadType: message?.payloadType || null,
    payloadKeys: message?.payload ? Object.keys(message.payload) : [],
    payload: message?.payload ? safePayload(message.payload) : undefined,
  };
}

function makeCTraderError(message, status = 502, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

class CTraderJsonSocket extends EventEmitter {
  constructor({ url = CTRADER_JSON_ENDPOINT, timeoutMs = CTRADER_SOCKET_TIMEOUT_MS } = {}) {
    super();
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.pending = new Map();
    this.isOpen = false;
    this.closingIntentionally = false;
  }

  connect() {
    if (this.socket && this.isOpen) {
      return Promise.resolve(this);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        const error = makeCTraderError(
          `Timed out connecting to cTrader WebSocket after ${this.timeoutMs}ms.`,
          504,
        );
        brokerError("ctrader:socket:connect-timeout", error, {
          url: this.url,
          timeoutMs: this.timeoutMs,
        });
        this.close();
        reject(error);
      }, this.timeoutMs);

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback(value);
      };

      this.socket = new WebSocket(this.url, {
        handshakeTimeout: this.timeoutMs,
      });

      this.socket.on("open", () => {
        this.isOpen = true;
        brokerLog("ctrader:socket:open", {
          url: this.url,
          readyState: this.socket.readyState,
        });
        this.emit("open");
        finish(resolve, this);
      });

      this.socket.on("message", (data) => this.handleMessage(data));

      this.socket.on("error", (error) => {
        brokerError("ctrader:socket:error", error, {
          url: this.url,
          ...safeSocketError(error),
        });

        if (!this.isOpen) {
          finish(reject, makeCTraderError(error.message, 502, safeSocketError(error)));
        }

        this.rejectPending(error);
      });

      this.socket.on("close", (code, reasonBuffer) => {
        const reason = reasonBuffer?.toString?.() || "";
        this.isOpen = false;
        brokerWarn("ctrader:socket:close", {
          url: this.url,
          code,
          reason,
          pendingRequests: this.pending.size,
          intentional: this.closingIntentionally,
        });
        this.emit("close", { code, reason, intentional: this.closingIntentionally });

        if (!settled) {
          finish(
            reject,
            makeCTraderError("cTrader WebSocket closed before it opened.", 502, {
              code,
              reason,
            }),
          );
        }

        if (!this.closingIntentionally) {
          this.rejectPending(
            makeCTraderError("cTrader WebSocket closed unexpectedly.", 502, {
              code,
              reason,
            }),
          );
        }
      });

      this.socket.on("unexpected-response", (_request, response) => {
        brokerWarn("ctrader:socket:unexpected-response", {
          url: this.url,
          statusCode: response.statusCode,
          statusMessage: response.statusMessage,
          headers: {
            server: response.headers?.server,
            date: response.headers?.date,
            connection: response.headers?.connection,
          },
        });
      });
    });
  }

  sendRequest(payloadType, payload, { expectedPayloadType, timeoutMs } = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        makeCTraderError("cTrader WebSocket is not connected.", 502),
      );
    }

    const clientMsgId = crypto.randomUUID();
    const envelope = {
      clientMsgId,
      payloadType,
      payload,
    };

    brokerLog("ctrader:socket:send", {
      clientMsgId,
      payloadType,
      expectedPayloadType,
      payload: safePayload(payload),
    });

    return new Promise((resolve, reject) => {
      const requestTimeout = setTimeout(() => {
        this.pending.delete(clientMsgId);
        reject(
          makeCTraderError("Timed out waiting for cTrader response.", 504, {
            clientMsgId,
            payloadType,
            expectedPayloadType,
          }),
        );
      }, timeoutMs || this.timeoutMs);

      this.pending.set(clientMsgId, {
        expectedPayloadType,
        resolve,
        reject,
        timeout: requestTimeout,
      });

      this.socket.send(JSON.stringify(envelope), (error) => {
        if (!error) return;

        clearTimeout(requestTimeout);
        this.pending.delete(clientMsgId);
        brokerError("ctrader:socket:send-error", error, {
          clientMsgId,
          payloadType,
          ...safeSocketError(error),
        });
        reject(error);
      });
    });
  }

  sendEvent(payloadType, payload = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    brokerLog("ctrader:socket:send-event", {
      payloadType,
      payload: safePayload(payload),
    });

    this.socket.send(JSON.stringify({ payloadType, payload }));
    return true;
  }

  handleMessage(data) {
    let message;

    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      brokerError("ctrader:socket:invalid-json", error, {
        rawLength: data?.length,
      });
      return;
    }

    brokerLog("ctrader:socket:message", safeMessageSummary(message));
    this.emit("message", message);

    const pending = message.clientMsgId
      ? this.pending.get(message.clientMsgId)
      : null;

    if (!pending) {
      this.emit("event", message);
      if (message.payloadType === CTRADER_PAYLOAD_TYPES.ERROR_RES) {
        brokerWarn("ctrader:socket:unmatched-error", safeMessageSummary(message));
      }
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(message.clientMsgId);

    if (message.payloadType === CTRADER_PAYLOAD_TYPES.ERROR_RES) {
      pending.reject(
        makeCTraderError(
          message.payload?.description ||
            message.payload?.errorCode ||
            "cTrader returned an error response.",
          502,
          safeMessageSummary(message),
        ),
      );
      return;
    }

    if (
      pending.expectedPayloadType &&
      message.payloadType !== pending.expectedPayloadType
    ) {
      pending.reject(
        makeCTraderError("cTrader returned an unexpected response type.", 502, {
          expectedPayloadType: pending.expectedPayloadType,
          ...safeMessageSummary(message),
        }),
      );
      return;
    }

    pending.resolve(message);
  }

  rejectPending(error) {
    for (const [clientMsgId, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(clientMsgId);
    }
  }

  close() {
    if (!this.socket) return;

    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.closingIntentionally = true;
      this.socket.close();
    }
  }
}

function createCTraderSocket(options) {
  return new CTraderJsonSocket(options);
}

async function testCTraderSocketConnection(options) {
  const client = createCTraderSocket(options);
  await client.connect();
  client.close();
  return { ok: true, url: client.url };
}

export {
  CTraderJsonSocket,
  createCTraderSocket,
  makeCTraderError,
  safeSocketError,
  testCTraderSocketConnection,
};
