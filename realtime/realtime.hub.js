import WebSocket, { WebSocketServer } from "ws";
import { verifyToken } from "../utils/token.js";
import { findUserById } from "../repositories/userRepository.js";
import { brokerLog, brokerWarn } from "../utils/brokerDebug.js";

let wss = null;
const clientsByUser = new Map();

function safeJson(value) {
  return JSON.stringify(value);
}

function addClient(userId, socket) {
  const key = String(userId);
  const clients = clientsByUser.get(key) || new Set();
  clients.add(socket);
  clientsByUser.set(key, clients);

  socket.on("close", () => {
    clients.delete(socket);
    if (!clients.size) clientsByUser.delete(key);
    brokerLog("realtime:client:closed", { userId: key, clients: clients.size });
  });
}

function sendToSocket(socket, event, payload) {
  if (socket.readyState !== WebSocket.OPEN) return false;
  socket.send(safeJson({ event, payload }));
  return true;
}

function emitToUser(userId, event, payload) {
  const key = String(userId);
  const clients = clientsByUser.get(key);
  if (!clients?.size) {
    brokerLog("realtime:emit:skipped", { userId: key, event, reason: "no clients" });
    return 0;
  }

  let sent = 0;
  for (const socket of clients) {
    if (socket.readyState === WebSocket.CLOSED) {
      clients.delete(socket);
      continue;
    }
    if (sendToSocket(socket, event, payload)) sent += 1;
  }

  if (!clients.size) clientsByUser.delete(key);

  brokerLog("realtime:emit:done", { userId: key, event, sent });
  return sent;
}

async function authenticateRealtimeRequest(request) {
  const url = new URL(request.url || "", "http://localhost");
  const token =
    url.searchParams.get("token") ||
    (request.headers.authorization || "").replace(/^Bearer\s+/i, "");

  if (!token) return null;

  const decoded = verifyToken(token);
  const user = await findUserById(decoded.sub);
  return user ? { userId: user.id || user._id } : null;
}

function initializeRealtime(server) {
  if (wss) return wss;

  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "", "http://localhost");
    if (url.pathname !== "/realtime") return;

    authenticateRealtimeRequest(request)
      .then((auth) => {
        if (!auth?.userId) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
          addClient(auth.userId, ws);
          brokerLog("realtime:client:connected", {
            userId: String(auth.userId),
          });
          sendToSocket(ws, "realtime:connected", { ok: true });
        });
      })
      .catch((error) => {
        brokerWarn("realtime:auth:error", { message: error.message });
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
      });
  });

  brokerLog("realtime:initialized");
  return wss;
}

export { emitToUser, initializeRealtime };
