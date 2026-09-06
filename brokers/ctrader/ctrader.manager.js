import BrokerConnection from "../../models/Broker.model.js";
import TradingAccount from "../../models/tradingAccounts.js";
import { brokerError, brokerLog, brokerWarn } from "../../utils/brokerDebug.js";
import {
  CTRADER_JSON_ENDPOINT,
  CTRADER_LIVE_JSON_ENDPOINT,
  CTRADER_PAYLOAD_TYPES,
} from "./ctrader.constants.js";
import { createCTraderSocket } from "./ctrader.socket.js";
import { handleCTraderExecutionEvent } from "./ctrader.events.js";
import { buildSymbolLookup } from "./ctrader.mapper.js";
import {
  authenticateCTraderApplication,
  authorizeCTraderAccount,
  requestSymbols,
  requestTrader,
} from "./ctrader.service.js";

const HEARTBEAT_MS = 10000;
const MAX_RECONNECT_MS = 30000;
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const CTRADER_TOKEN_URL = "https://openapi.ctrader.com/apps/token";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectionEnvironment(connection) {
  return connection.accountType === "live" ? "live" : "demo";
}

function getManagerCTraderConfig() {
  const clientId = process.env.CTRADER_CLIENT_ID;
  const clientSecret = process.env.CTRADER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "CTRADER_CLIENT_ID and CTRADER_CLIENT_SECRET are required for cTrader realtime.",
    );
  }

  return { clientId, clientSecret };
}

function tokenNeedsRefresh(connection) {
  if (!connection.tokenExpiresAt) return false;
  return (
    new Date(connection.tokenExpiresAt).getTime() - Date.now() <
    TOKEN_REFRESH_SKEW_MS
  );
}

async function refreshCTraderTokens(connection) {
  const refreshToken = connection.getRefreshToken?.();
  if (!refreshToken) {
    throw new Error("cTrader refresh token is missing.");
  }

  const { clientId, clientSecret } = getManagerCTraderConfig();
  const tokenUrl = new URL(CTRADER_TOKEN_URL);
  tokenUrl.searchParams.set("grant_type", "refresh_token");
  tokenUrl.searchParams.set("refresh_token", refreshToken);
  tokenUrl.searchParams.set("client_id", clientId);
  tokenUrl.searchParams.set("client_secret", clientSecret);

  brokerLog("ctrader:token-refresh:start", {
    connectionId: String(connection._id),
    ctidTraderAccountId: connection.externalAccountId,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  const payload = await response.json();

  if (!response.ok || payload.errorCode || !payload.accessToken) {
    throw new Error(
      payload.description ||
        payload.errorCode ||
        "Failed to refresh cTrader access token.",
    );
  }

  connection.accessToken = payload.accessToken;
  connection.refreshToken = payload.refreshToken;
  connection.tokenExpiresAt = new Date(
    Date.now() + Number(payload.expiresIn || 2628000) * 1000,
  );
  connection.status = "connected";
  await connection.save();

  brokerLog("ctrader:token-refresh:done", {
    connectionId: String(connection._id),
    tokenExpiresAt: connection.tokenExpiresAt,
  });

  return connection;
}

class CTraderSharedConnection {
  constructor(environment) {
    this.environment = environment;
    this.url =
      environment === "live" ? CTRADER_LIVE_JSON_ENDPOINT : CTRADER_JSON_ENDPOINT;
    this.socket = null;
    this.connected = false;
    this.started = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.accounts = new Map();
    this.symbolLookups = new Map();
    this.moneyDigitsByAccount = new Map();
  }

  async start() {
    if (this.started) return;
    this.started = true;
    await this.connect();
  }

  async connect() {
    try {
      this.socket = createCTraderSocket({ url: this.url });
      this.socket.on("event", (message) => this.handleEvent(message));
      this.socket.on("close", ({ intentional }) => {
        this.connected = false;
        this.stopHeartbeat();
        if (!intentional && this.started) this.scheduleReconnect();
      });

      await this.socket.connect();
      const { clientId, clientSecret } = getManagerCTraderConfig();
      await authenticateCTraderApplication(this.socket, {
        clientId,
        clientSecret,
      });

      this.connected = true;
      this.reconnectAttempt = 0;
      this.startHeartbeat();

      brokerLog("ctrader:manager:connected", {
        environment: this.environment,
        accounts: this.accounts.size,
      });

      await this.reauthenticateAccounts();
    } catch (error) {
      brokerError("ctrader:manager:connect:error", error, {
        environment: this.environment,
      });
      this.connected = false;
      this.scheduleReconnect();
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected || !this.socket) return;
      this.socket.sendEvent(CTRADER_PAYLOAD_TYPES.HEARTBEAT_EVENT);
    }, HEARTBEAT_MS);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;

    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_MS);
    this.reconnectAttempt += 1;

    brokerWarn("ctrader:manager:reconnect:scheduled", {
      environment: this.environment,
      delay,
    });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.connect();
    }, delay);
  }

  async ensureConnected() {
    if (this.connected && this.socket) return;
    await this.start();
    let attempts = 0;
    while (!this.connected && attempts < 15) {
      await wait(500);
      attempts += 1;
    }
    if (!this.connected) {
      throw new Error(`cTrader ${this.environment} connection is not ready.`);
    }
  }

  async registerConnection(connection) {
    if (tokenNeedsRefresh(connection)) {
      try {
        connection = await refreshCTraderTokens(connection);
      } catch (error) {
        brokerError("ctrader:token-refresh:error", error, {
          connectionId: String(connection._id),
        });
        connection.status = "reauthorization_required";
        await connection.save();
        return false;
      }
    }

    const accessToken = connection.getAccessToken?.();
    if (!connection.externalAccountId || !accessToken) return false;

    const tradingAccount = await TradingAccount.findOne({
      userId: connection.userId,
      accountNumber: String(connection.externalAccountId),
      platform: "ctrader",
      isArchived: false,
    }).sort({ updatedAt: -1 });

    if (!tradingAccount) {
      brokerWarn("ctrader:manager:register:no-trading-account", {
        connectionId: String(connection._id),
        ctidTraderAccountId: String(connection.externalAccountId),
      });
      return false;
    }

    const accountKey = String(connection.externalAccountId);
    this.accounts.set(accountKey, {
      userId: connection.userId,
      brokerConnectionId: connection._id,
      tradingAccount,
      connection,
    });

    await this.ensureConnected();
    await authorizeCTraderAccount(this.socket, {
      ctidTraderAccountId: connection.externalAccountId,
      accessToken,
    });

    const [trader, symbolResult] = await Promise.all([
      requestTrader(this.socket, connection.externalAccountId),
      requestSymbols(this.socket, connection.externalAccountId),
    ]);

    this.moneyDigitsByAccount.set(accountKey, trader?.moneyDigits ?? 2);
    this.symbolLookups.set(
      accountKey,
      buildSymbolLookup(symbolResult.symbols, symbolResult.archivedSymbols),
    );

    brokerLog("ctrader:manager:account:registered", {
      environment: this.environment,
      connectionId: String(connection._id),
      ctidTraderAccountId: accountKey,
    });

    return true;
  }

  async reauthenticateAccounts() {
    const accountTypeQuery =
      this.environment === "live" ? "live" : { $ne: "live" };
    const connections = await BrokerConnection.find({
      provider: "ctrader",
      status: "connected",
      accountType: accountTypeQuery,
      externalAccountId: { $exists: true, $ne: "" },
    }).select("+accessToken +refreshToken");

    for (const connection of connections) {
      try {
        await this.registerConnection(connection);
      } catch (error) {
        brokerError("ctrader:manager:account:register:error", error, {
          connectionId: String(connection._id),
          ctidTraderAccountId: connection.externalAccountId,
        });
      }
    }
  }

  async handleEvent(message) {
    if (message.payloadType !== CTRADER_PAYLOAD_TYPES.EXECUTION_EVENT) return;

    try {
      await handleCTraderExecutionEvent({
        payload: message.payload,
        context: {
          accounts: this.accounts,
          symbolLookups: this.symbolLookups,
          moneyDigitsByAccount: this.moneyDigitsByAccount,
        },
      });
    } catch (error) {
      brokerError("ctrader:manager:event:error", error, {
        environment: this.environment,
        payloadType: message.payloadType,
        ctidTraderAccountId: message.payload?.ctidTraderAccountId,
      });
    }
  }
}

class CTraderManager {
  constructor() {
    this.connections = new Map([
      ["demo", new CTraderSharedConnection("demo")],
      ["live", new CTraderSharedConnection("live")],
    ]);
  }

  async start() {
    const enabled = process.env.CTRADER_REALTIME_ENABLED !== "false";
    if (!enabled) {
      brokerWarn("ctrader:manager:disabled");
      return;
    }

    const existingConnections = await BrokerConnection.find({
      provider: "ctrader",
      status: "connected",
      externalAccountId: { $exists: true, $ne: "" },
    }).select("accountType");
    const environments = new Set(existingConnections.map(connectionEnvironment));

    await Promise.all(
      Array.from(environments).map((environment) =>
        this.connections.get(environment)?.start(),
      ),
    );

    brokerLog("ctrader:manager:started", {
      environments: Array.from(environments),
    });
  }

  async registerBrokerConnection(connectionId) {
    const connection = await BrokerConnection.findById(connectionId).select(
      "+accessToken +refreshToken",
    );
    if (!connection) return false;

    const environment = connectionEnvironment(connection);
    const sharedConnection = this.connections.get(environment);
    return sharedConnection?.registerConnection(connection);
  }
}

const cTraderManager = new CTraderManager();

export { cTraderManager };
