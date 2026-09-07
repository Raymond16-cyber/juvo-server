import BrokerConnection from "../../models/Broker.model.js";
import TradingAccount from "../../models/tradingAccounts.js";
import BrokerPosition from "../../models/BrokerPosition.model.js";
import { emitToUser } from "../../realtime/realtime.hub.js";
import { brokerError, brokerLog, brokerWarn } from "../../utils/brokerDebug.js";
import {
  CTRADER_JSON_ENDPOINT,
  CTRADER_EXECUTION_TYPE,
  CTRADER_LIVE_JSON_ENDPOINT,
  CTRADER_PAYLOAD_TYPES,
} from "./ctrader.constants.js";
import { createCTraderSocket } from "./ctrader.socket.js";
import { handleCTraderExecutionEvent } from "./ctrader.events.js";
import {
  buildSymbolLookup,
  buildSymbolMetadataMap,
  convertSpotPrice,
  normalizeUnrealizedPnl,
  projectLivePosition,
} from "./ctrader.mapper.js";
import {
  authenticateCTraderApplication,
  authorizeCTraderAccount,
  requestPositionUnrealizedPnl,
  requestReconcile,
  requestSymbolById,
  requestSymbols,
  requestTrader,
} from "./ctrader.service.js";

const HEARTBEAT_MS = 10000;
const MAX_RECONNECT_MS = 30000;
const PNL_REFRESH_MS = 2500;
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
    this.symbolMetadataByAccount = new Map();
    this.moneyDigitsByAccount = new Map();
    this.quoteCache = new Map();
    this.pnlCache = new Map();
    this.pnlRefreshTimers = new Map();
    this.pnlRefreshInFlight = new Set();
    this.spotSubscriptions = new Map();
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
        this.stopAllPnlPolling();
        this.markSpotSubscriptionsStale();
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

  pnlKey(ctidTraderAccountId, positionId) {
    return `${ctidTraderAccountId}:${positionId}`;
  }

  startPnlPolling(ctidTraderAccountId) {
    const accountKey = String(ctidTraderAccountId);
    if (this.pnlRefreshTimers.has(accountKey)) return;

    const refresh = () => {
      void this.refreshUnrealizedPnl(accountKey);
    };

    refresh();
    this.pnlRefreshTimers.set(accountKey, setInterval(refresh, PNL_REFRESH_MS));

    brokerLog("ctrader:unrealized-pnl:polling:start", {
      account: accountKey,
      intervalMs: PNL_REFRESH_MS,
    });
  }

  stopPnlPolling(ctidTraderAccountId) {
    const accountKey = String(ctidTraderAccountId);
    const timer = this.pnlRefreshTimers.get(accountKey);
    if (timer) clearInterval(timer);
    this.pnlRefreshTimers.delete(accountKey);
    this.pnlRefreshInFlight.delete(accountKey);

    for (const key of this.pnlCache.keys()) {
      if (key.startsWith(`${accountKey}:`)) this.pnlCache.delete(key);
    }

    brokerLog("ctrader:unrealized-pnl:polling:stop", {
      account: accountKey,
    });
  }

  stopAllPnlPolling() {
    for (const accountKey of Array.from(this.pnlRefreshTimers.keys())) {
      this.stopPnlPolling(accountKey);
    }
  }

  markSpotSubscriptionsStale() {
    this.quoteCache.clear();
    for (const subscription of this.spotSubscriptions.values()) {
      subscription.subscribed = false;
    }
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

    const [trader, symbolResult, reconcile] = await Promise.all([
      requestTrader(this.socket, connection.externalAccountId),
      requestSymbols(this.socket, connection.externalAccountId),
      requestReconcile(this.socket, connection.externalAccountId),
    ]);
    const symbolIds = Array.from(
      new Set(
        (reconcile.positions || [])
          .map((position) => position?.tradeData?.symbolId)
          .filter(Boolean),
      ),
    );
    const detailedSymbols = await requestSymbolById(
      this.socket,
      connection.externalAccountId,
      symbolIds,
    );

    this.moneyDigitsByAccount.set(accountKey, trader?.moneyDigits ?? 2);
    this.symbolLookups.set(
      accountKey,
      buildSymbolLookup(symbolResult.symbols, symbolResult.archivedSymbols),
    );
    this.symbolMetadataByAccount.set(
      accountKey,
      buildSymbolMetadataMap(detailedSymbols.symbols),
    );
    for (const position of reconcile.positions || []) {
      await handleCTraderExecutionEvent({
        payload: {
          ctidTraderAccountId: connection.externalAccountId,
          executionType: CTRADER_EXECUTION_TYPE.ORDER_FILLED,
          position,
        },
        context: {
          accounts: this.accounts,
          symbolLookups: this.symbolLookups,
          symbolMetadataByAccount: this.symbolMetadataByAccount,
          moneyDigitsByAccount: this.moneyDigitsByAccount,
          ensureSpotSubscription: ({ ctidTraderAccountId, symbolId, positionId }) =>
            this.ensureSpotSubscription({
              ctidTraderAccountId,
              symbolId,
              positionId,
            }),
          releaseSpotSubscription: ({ ctidTraderAccountId, symbolId, positionId }) =>
            this.releaseSpotSubscription({
              ctidTraderAccountId,
              symbolId,
              positionId,
            }),
          releasePositionPnl: ({ ctidTraderAccountId, positionId }) =>
            this.releasePositionPnl({ ctidTraderAccountId, positionId }),
        },
      });
    }
    if ((reconcile.positions || []).length) {
      this.startPnlPolling(accountKey);
    }

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
    if (message.payloadType === CTRADER_PAYLOAD_TYPES.SPOT_EVENT) {
      await this.handleSpotEvent(message.payload);
      return;
    }

    if (message.payloadType !== CTRADER_PAYLOAD_TYPES.EXECUTION_EVENT) return;

    try {
      await handleCTraderExecutionEvent({
        payload: message.payload,
        context: {
          accounts: this.accounts,
          symbolLookups: this.symbolLookups,
          symbolMetadataByAccount: this.symbolMetadataByAccount,
          moneyDigitsByAccount: this.moneyDigitsByAccount,
          ensureSpotSubscription: ({ ctidTraderAccountId, symbolId, positionId }) =>
            this.ensureSpotSubscription({
              ctidTraderAccountId,
              symbolId,
              positionId,
            }),
          releaseSpotSubscription: ({ ctidTraderAccountId, symbolId, positionId }) =>
            this.releaseSpotSubscription({
              ctidTraderAccountId,
              symbolId,
              positionId,
            }),
          releasePositionPnl: ({ ctidTraderAccountId, positionId }) =>
            this.releasePositionPnl({ ctidTraderAccountId, positionId }),
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

  quoteKey(ctidTraderAccountId, symbolId) {
    return `${ctidTraderAccountId}:${symbolId}`;
  }

  async ensureSymbolMetadata(ctidTraderAccountId, symbolId) {
    const accountKey = String(ctidTraderAccountId);
    const symbolKey = String(symbolId);
    let metadata = this.symbolMetadataByAccount.get(accountKey);
    if (metadata?.has(symbolKey)) return metadata.get(symbolKey);

    const result = await requestSymbolById(this.socket, ctidTraderAccountId, [
      symbolId,
    ]);
    metadata = metadata || new Map();
    for (const symbol of result.symbols || []) {
      if (symbol?.symbolId == null) continue;
      metadata.set(String(symbol.symbolId), symbol);
    }
    this.symbolMetadataByAccount.set(accountKey, metadata);
    return metadata.get(symbolKey);
  }

  async ensureSpotSubscription({ ctidTraderAccountId, symbolId, positionId }) {
    if (!ctidTraderAccountId || !symbolId || !positionId) return false;
    await this.ensureConnected();
    await this.ensureSymbolMetadata(ctidTraderAccountId, symbolId);
    this.startPnlPolling(ctidTraderAccountId);

    const key = this.quoteKey(ctidTraderAccountId, symbolId);
    const subscription = this.spotSubscriptions.get(key) || {
      ctidTraderAccountId: String(ctidTraderAccountId),
      symbolId: String(symbolId),
      positionIds: new Set(),
      subscribed: false,
    };
    subscription.positionIds.add(String(positionId));
    this.spotSubscriptions.set(key, subscription);

    if (subscription.subscribed) return true;

    brokerLog("ctrader:spots:subscribing", {
      account: String(ctidTraderAccountId),
      symbol: String(symbolId),
    });

    await this.socket.sendRequest(
      CTRADER_PAYLOAD_TYPES.SUBSCRIBE_SPOTS_REQ,
      {
        ctidTraderAccountId: Number(ctidTraderAccountId),
        symbolId: [Number(symbolId)],
        subscribeToSpotTimestamp: true,
      },
      {
        expectedPayloadType: CTRADER_PAYLOAD_TYPES.SUBSCRIBE_SPOTS_RES,
      },
    );

    subscription.subscribed = true;
    brokerLog("ctrader:spots:subscribed", {
      account: String(ctidTraderAccountId),
      symbol: String(symbolId),
    });
    return true;
  }

  async releaseSpotSubscription({ ctidTraderAccountId, symbolId, positionId }) {
    if (!ctidTraderAccountId || !symbolId || !positionId || !this.socket) return false;
    const key = this.quoteKey(ctidTraderAccountId, symbolId);
    const subscription = this.spotSubscriptions.get(key);
    if (!subscription) return false;

    subscription.positionIds.delete(String(positionId));
    if (subscription.positionIds.size) return true;

    brokerLog("ctrader:spots:releasing", {
      account: String(ctidTraderAccountId),
      symbol: String(symbolId),
    });

    await this.socket.sendRequest(
      CTRADER_PAYLOAD_TYPES.UNSUBSCRIBE_SPOTS_REQ,
      {
        ctidTraderAccountId: Number(ctidTraderAccountId),
        symbolId: [Number(symbolId)],
      },
      {
        expectedPayloadType: CTRADER_PAYLOAD_TYPES.UNSUBSCRIBE_SPOTS_RES,
      },
    );

    this.spotSubscriptions.delete(key);
    this.quoteCache.delete(key);
    this.stopPnlPollingIfIdle(ctidTraderAccountId);
    brokerLog("ctrader:spots:released", {
      account: String(ctidTraderAccountId),
      symbol: String(symbolId),
    });
    return true;
  }

  releasePositionPnl({ ctidTraderAccountId, positionId }) {
    if (!ctidTraderAccountId || !positionId) return;
    this.pnlCache.delete(this.pnlKey(ctidTraderAccountId, positionId));
    this.stopPnlPollingIfIdle(ctidTraderAccountId);
  }

  stopPnlPollingIfIdle(ctidTraderAccountId) {
    const accountKey = String(ctidTraderAccountId);
    const hasActiveSubscription = Array.from(this.spotSubscriptions.values()).some(
      (subscription) =>
        subscription.ctidTraderAccountId === accountKey &&
        subscription.positionIds.size > 0,
    );
    if (!hasActiveSubscription) this.stopPnlPolling(accountKey);
  }

  async refreshUnrealizedPnl(ctidTraderAccountId) {
    const accountKey = String(ctidTraderAccountId);
    if (!this.connected || !this.socket || this.pnlRefreshInFlight.has(accountKey)) {
      return;
    }

    this.pnlRefreshInFlight.add(accountKey);
    try {
      const result = await requestPositionUnrealizedPnl(this.socket, accountKey);
      const moneyDigits =
        result.moneyDigits ?? this.moneyDigitsByAccount.get(accountKey) ?? 2;
      const timestamp = Date.now();

      for (const value of result.values || []) {
        const normalized = normalizeUnrealizedPnl(value, moneyDigits);
        if (!normalized?.positionId) continue;
        this.pnlCache.set(this.pnlKey(accountKey, normalized.positionId), {
          ...normalized,
          timestamp,
        });
      }

      await this.emitPositionUpdatesForAccount(accountKey);
    } catch (error) {
      brokerWarn("ctrader:unrealized-pnl:refresh:error", {
        account: accountKey,
        message: error.message,
      });
    } finally {
      this.pnlRefreshInFlight.delete(accountKey);
    }
  }

  async handleSpotEvent(payload) {
    if (!payload?.ctidTraderAccountId || !payload?.symbolId) return;
    const accountKey = String(payload.ctidTraderAccountId);
    const symbolKey = String(payload.symbolId);
    const key = this.quoteKey(accountKey, symbolKey);
    const symbol = await this.ensureSymbolMetadata(accountKey, symbolKey);
    const previous = this.quoteCache.get(key) || {};
    const quote = {
      bid:
        payload.bid != null
          ? convertSpotPrice(payload.bid, symbol)
          : previous.bid,
      ask:
        payload.ask != null
          ? convertSpotPrice(payload.ask, symbol)
          : previous.ask,
      timestamp: payload.timestamp || Date.now(),
    };
    this.quoteCache.set(key, quote);

    const symbolName =
      this.symbolLookups.get(accountKey)?.get(symbolKey) || `SYMBOL-${symbolKey}`;
    brokerLog("ctrader:quote", {
      symbol: symbolName,
      bid: quote.bid,
      ask: quote.ask,
    });

    await this.emitPositionUpdatesForSymbol(accountKey, symbolKey, quote, symbol);
  }

  async emitPositionUpdatesForSymbol(ctidTraderAccountId, symbolId, quote, symbol) {
    const owner = this.accounts.get(String(ctidTraderAccountId));
    if (!owner) return;

    const positions = await BrokerPosition.find({
      userId: owner.userId,
      provider: "ctrader",
      ctidTraderAccountId: String(ctidTraderAccountId),
      symbolId: String(symbolId),
      status: "open",
    }).lean();

    for (const position of positions) {
      this.emitPositionUpdate(owner, position, quote, symbol);
    }
  }

  async emitPositionUpdatesForAccount(ctidTraderAccountId) {
    const accountKey = String(ctidTraderAccountId);
    const owner = this.accounts.get(accountKey);
    if (!owner) return;

    const positions = await BrokerPosition.find({
      userId: owner.userId,
      provider: "ctrader",
      ctidTraderAccountId: accountKey,
      status: "open",
    }).lean();

    for (const position of positions) {
      const symbolKey = String(position.symbolId);
      const quote = this.quoteCache.get(this.quoteKey(accountKey, symbolKey));
      const symbol = this.symbolMetadataByAccount
        .get(accountKey)
        ?.get(symbolKey);
      this.emitPositionUpdate(owner, position, quote, symbol);
    }
  }

  emitPositionUpdate(owner, position, quote, symbol) {
    const unrealizedPnl = this.pnlCache.get(
      this.pnlKey(position.ctidTraderAccountId, position.externalPositionId),
    );
    const live = projectLivePosition({ position, quote, symbol, unrealizedPnl });
    emitToUser(owner.userId, "position:update", {
      positionId: String(position._id),
      tradingAccountId: String(position.tradingAccount),
      provider: "ctrader",
      symbol: position.symbol,
      side: position.direction,
      entryPrice: position.entryPrice,
      ...live,
    });

    brokerLog("realtime:position:update:emitted", {
      userId: String(owner.userId),
      positionId: String(position._id),
      symbol: position.symbol,
      hasQuote: Boolean(quote),
      hasBrokerPnl: Boolean(unrealizedPnl),
    });
  }

  enrichPosition(position) {
    const accountId = position.ctidTraderAccountId;
    const symbolId = position.symbolId;
    if (!accountId || !symbolId) return position;
    const quote = this.quoteCache.get(this.quoteKey(accountId, symbolId));
    const symbol = this.symbolMetadataByAccount
      .get(String(accountId))
      ?.get(String(symbolId));
    const unrealizedPnl = this.pnlCache.get(
      this.pnlKey(accountId, position.externalPositionId),
    );
    if (!quote && !unrealizedPnl) return position;
    return {
      ...position,
      live: projectLivePosition({ position, quote, symbol, unrealizedPnl }),
    };
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

  enrichPositionForClient(position) {
    for (const sharedConnection of this.connections.values()) {
      const enriched = sharedConnection.enrichPosition(position);
      if (enriched !== position) return enriched;
    }
    return position;
  }
}

const cTraderManager = new CTraderManager();

export { cTraderManager };
