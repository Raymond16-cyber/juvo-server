import BrokerConnection from "../models/Broker.model.js";
import BrokerPosition from "../models/BrokerPosition.model.js";
import Journal from "../models/Journal.js";
import Trade from "../models/Trades.js";
import TradingAccount from "../models/tradingAccounts.js";
import User from "../models/User.js";
import { signOAuthState, verifyOAuthState } from "../utils/token.js";
import {
  brokerError,
  brokerLog,
  brokerWarn,
  redactSecret,
} from "../utils/brokerDebug.js";
import { getCTraderReadOnlySnapshot } from "../brokers/ctrader/ctrader.service.js";
import { cTraderManager } from "../brokers/ctrader/ctrader.manager.js";

const CTRADER_AUTHORIZE_URL =
  "https://id.ctrader.com/my/settings/openapi/grantingaccess/";
const CTRADER_TOKEN_URL = "https://openapi.ctrader.com/apps/token";
const OAUTH_COOKIE_NAME = "juvo_ctrader_oauth";
const TRADE_SIDE_BUY = 1;
const TRADE_SIDE_SELL = 2;

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getUserId(user) {
  return user?.id || user?._id;
}

function startOfUtcDay(timestamp) {
  const date = new Date(Number(timestamp || Date.now()));
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function moneyToNumber(value, moneyDigits = 2) {
  const numericValue = Number(value || 0);
  const digits = Number.isFinite(Number(moneyDigits)) ? Number(moneyDigits) : 2;
  return Number((numericValue / 10 ** digits).toFixed(2));
}

function volumeToLots(value) {
  return Number((Number(value || 0) / 10000000).toFixed(2));
}

function buildSymbolLookup(symbols = [], archivedSymbols = []) {
  const lookup = new Map();
  [...symbols, ...archivedSymbols].forEach((symbol) => {
    if (symbol?.symbolId == null) return;
    lookup.set(String(symbol.symbolId), symbol.symbolName || symbol.name);
  });
  return lookup;
}

function inferInstrument(symbol = "") {
  const normalized = symbol.toUpperCase();
  if (normalized.includes("/") || /^[A-Z]{6}$/.test(normalized)) return "forex";
  if (
    normalized.includes("BTC") ||
    normalized.includes("ETH") ||
    normalized.includes("USDT")
  ) {
    return "crypto";
  }
  if (["XAU", "XAG", "OIL", "WTI", "BRENT"].some((key) => normalized.includes(key))) {
    return "commodities";
  }
  if (["US30", "NAS", "SPX", "DAX", "UK100"].some((key) => normalized.includes(key))) {
    return "indices";
  }
  return "others";
}

function getDepositCurrency(trader, assets = []) {
  const depositAssetId = trader?.depositAssetId;
  const asset = assets.find((item) => String(item.assetId) === String(depositAssetId));
  return asset?.displayName || asset?.name || "USD";
}

function getBrokerTitle(account, trader) {
  return (
    trader?.brokerName ||
    account?.brokerTitleShort ||
    account?.brokerTitle ||
    "cTrader"
  );
}

function mapCTraderDealToTrade({ deal, ctidTraderAccountId, symbolLookup, moneyDigits }) {
  const closeDetail = deal?.closePositionDetail;
  if (!closeDetail || deal.dealStatus !== 2) return null;

  const symbol =
    symbolLookup.get(String(deal.symbolId)) || `SYMBOL-${String(deal.symbolId)}`;
  const entryPrice = Number(closeDetail.entryPrice || 0);
  const exitPrice = Number(deal.executionPrice || 0);
  if (!entryPrice || !exitPrice) return null;

  const direction = deal.tradeSide === TRADE_SIDE_SELL ? "long" : "short";
  const dealMoneyDigits = closeDetail.moneyDigits ?? deal.moneyDigits ?? moneyDigits;
  const grossProfit = moneyToNumber(closeDetail.grossProfit, dealMoneyDigits);
  const swap = moneyToNumber(closeDetail.swap, dealMoneyDigits);
  const commission = moneyToNumber(closeDetail.commission, dealMoneyDigits);
  const pnlConversionFee = moneyToNumber(closeDetail.pnlConversionFee, dealMoneyDigits);
  const profitLoss = Number(
    (grossProfit + swap + commission + pnlConversionFee).toFixed(2),
  );

  return {
    symbol,
    instrument: inferInstrument(symbol),
    direction,
    entryPrice,
    exitPrice,
    stopLoss: entryPrice,
    takeProfit: exitPrice,
    lotSize: volumeToLots(closeDetail.closedVolume || deal.filledVolume || deal.volume),
    riskPercentage: 0,
    plannedRR: 0,
    achievedRR: 0,
    profitLoss,
    status: "Closed",
    openedAt: new Date(deal.createTimestamp || deal.executionTimestamp),
    closedAt: new Date(deal.executionTimestamp || deal.createTimestamp),
    notes: "Imported from cTrader.",
    source: "ctrader",
    externalId: `${ctidTraderAccountId}:${deal.dealId}`,
    externalPositionId: deal.positionId != null ? String(deal.positionId) : undefined,
    externalOrderId: deal.orderId != null ? String(deal.orderId) : undefined,
    rawSource: {
      provider: "ctrader",
      ctidTraderAccountId: String(ctidTraderAccountId),
      dealId: deal.dealId,
      orderId: deal.orderId,
      positionId: deal.positionId,
      symbolId: deal.symbolId,
    },
  };
}

async function upsertTradingAccountFromCTrader({ userId, snapshot }) {
  const trader = snapshot.trader || {};
  const account = snapshot.selectedAccount;
  const ctidTraderAccountId = account.ctidTraderAccountId;
  const brokerTitle = getBrokerTitle(account, trader);
  const moneyDigits = trader.moneyDigits ?? 2;
  const balance = moneyToNumber(trader.balance, moneyDigits);
  const leverage = trader.leverageInCents
    ? `1:${Math.round(Number(trader.leverageInCents) / 100)}`
    : "1:1";

  const tradingAccount = await TradingAccount.findOneAndUpdate(
    {
      userId,
      accountNumber: String(ctidTraderAccountId),
      broker: brokerTitle,
      platform: "ctrader",
    },
    {
      $set: {
        accountName: `${brokerTitle} ${trader.traderLogin || ctidTraderAccountId}`,
        accountType: account.isLive ? "live" : "demo",
        currentBalance: balance,
        currentEquity: balance,
        leverage,
        currency: getDepositCurrency(trader, snapshot.assets),
        isConnected: true,
        isArchived: false,
        lastSyncedAt: new Date(),
      },
      $setOnInsert: {
        userId,
        accountNumber: String(ctidTraderAccountId),
        broker: brokerTitle,
        platform: "ctrader",
        initialBalance: balance,
        maxDrawnDown: 0,
        profitTarget: 0,
        isActive: false,
        status: "Active",
      },
    },
    { new: true, upsert: true },
  );

  return tradingAccount;
}

function mapCTraderPosition({ position, ctidTraderAccountId, symbolLookup, moneyDigits }) {
  const tradeData = position?.tradeData || {};
  if (!position?.positionId || !tradeData.symbolId) return null;

  const symbol =
    symbolLookup.get(String(tradeData.symbolId)) ||
    `SYMBOL-${String(tradeData.symbolId)}`;
  const positionMoneyDigits = position.moneyDigits ?? moneyDigits;

  return {
    provider: "ctrader",
    ctidTraderAccountId: String(ctidTraderAccountId),
    externalPositionId: String(position.positionId),
    symbol,
    symbolId: String(tradeData.symbolId),
    direction: tradeData.tradeSide === TRADE_SIDE_SELL ? "short" : "long",
    volume: Number(tradeData.volume || 0),
    lotSize: volumeToLots(tradeData.volume),
    entryPrice: Number(position.price || 0),
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    swap: moneyToNumber(position.swap, positionMoneyDigits),
    commission: moneyToNumber(position.commission, positionMoneyDigits),
    usedMargin: moneyToNumber(position.usedMargin, positionMoneyDigits),
    status: position.positionStatus === 1 ? "open" : "unknown",
    openedAt: tradeData.openTimestamp ? new Date(tradeData.openTimestamp) : undefined,
    brokerUpdatedAt: position.utcLastUpdateTimestamp
      ? new Date(position.utcLastUpdateTimestamp)
      : undefined,
    syncedAt: new Date(),
    label: tradeData.label,
    comment: tradeData.comment,
    rawSource: {
      provider: "ctrader",
      ctidTraderAccountId: String(ctidTraderAccountId),
      positionId: position.positionId,
      symbolId: tradeData.symbolId,
      positionStatus: position.positionStatus,
    },
  };
}

async function syncCTraderOpenPositions({
  userId,
  brokerConnectionId,
  tradingAccount,
  snapshot,
}) {
  const symbolLookup = buildSymbolLookup(snapshot.symbols, snapshot.archivedSymbols);
  const moneyDigits = snapshot.trader?.moneyDigits ?? 2;
  const ctidTraderAccountId = snapshot.selectedAccount.ctidTraderAccountId;
  const seenPositionIds = [];
  let upserted = 0;
  let skipped = 0;

  for (const position of snapshot.positions || []) {
    const payload = mapCTraderPosition({
      position,
      ctidTraderAccountId,
      symbolLookup,
      moneyDigits,
    });

    if (!payload) {
      skipped += 1;
      continue;
    }

    seenPositionIds.push(payload.externalPositionId);

    await BrokerPosition.findOneAndUpdate(
      {
        userId,
        provider: "ctrader",
        ctidTraderAccountId: payload.ctidTraderAccountId,
        externalPositionId: payload.externalPositionId,
      },
      {
        $set: {
          ...payload,
          userId,
          tradingAccount: tradingAccount._id,
          brokerConnection: brokerConnectionId,
          closedAt: undefined,
        },
      },
      { new: true, upsert: true },
    );

    upserted += 1;
  }

  const closeFilter = {
    userId,
    provider: "ctrader",
    ctidTraderAccountId: String(ctidTraderAccountId),
    status: "open",
  };
  if (seenPositionIds.length) {
    closeFilter.externalPositionId = { $nin: seenPositionIds };
  }

  const closedResult = await BrokerPosition.updateMany(closeFilter, {
    $set: {
      status: "closed",
      closedAt: new Date(),
      syncedAt: new Date(),
    },
  });

  brokerLog("ctrader:positions:sync:done", {
    upserted,
    skipped,
    markedClosed: closedResult.modifiedCount || 0,
  });

  return {
    upserted,
    skipped,
    markedClosed: closedResult.modifiedCount || 0,
  };
}

async function findOrCreateImportedJournal({ userId, tradingAccountId, timestamp }) {
  const journalDate = startOfUtcDay(timestamp);
  return Journal.findOneAndUpdate(
    {
      user: userId,
      journalDate,
    },
    {
      $setOnInsert: {
        user: userId,
        tradingAccount: tradingAccountId,
        journalDate,
        status: "Started",
        psychology: {},
        review: {},
        discipline: {},
      },
    },
    { new: true, upsert: true },
  );
}

async function importCTraderClosedDeals({ userId, tradingAccount, snapshot }) {
  const symbolLookup = buildSymbolLookup(snapshot.symbols, snapshot.archivedSymbols);
  const moneyDigits = snapshot.trader?.moneyDigits ?? 2;
  let imported = 0;
  let skipped = 0;

  for (const deal of snapshot.deals || []) {
    const tradePayload = mapCTraderDealToTrade({
      deal,
      ctidTraderAccountId: snapshot.selectedAccount.ctidTraderAccountId,
      symbolLookup,
      moneyDigits,
    });

    if (!tradePayload) {
      skipped += 1;
      continue;
    }

    const existing = await Trade.findOne({
      user: userId,
      source: "ctrader",
      externalId: tradePayload.externalId,
    }).select("_id");

    if (existing) {
      skipped += 1;
      continue;
    }

    const journal = await findOrCreateImportedJournal({
      userId,
      tradingAccountId: tradingAccount._id,
      timestamp: tradePayload.closedAt,
    });

    const trade = await Trade.create({
      ...tradePayload,
      user: userId,
      journal: journal._id,
      tradingAccount: tradingAccount._id,
    });

    await Promise.all([
      Journal.updateOne({ _id: journal._id }, { $addToSet: { trades: trade._id } }),
      TradingAccount.updateOne(
        { _id: tradingAccount._id },
        { $addToSet: { trades: trade._id } },
      ),
      User.findByIdAndUpdate(userId, { $inc: { "stats.totalTrades": 1 } }),
    ]);

    imported += 1;
  }

  brokerLog("ctrader:import:done", {
    imported,
    skipped,
    totalDeals: snapshot.deals?.length || 0,
    hasMoreDeals: snapshot.hasMoreDeals,
  });

  return { imported, skipped };
}

function getCTraderConfig() {
  const clientId = process.env.CTRADER_CLIENT_ID;
  const clientSecret = process.env.CTRADER_CLIENT_SECRET;
  const redirectUri = process.env.CTRADER_REDIRECT_URI;
  const clientOrigin =
    process.env.CLIENT_ORIGIN ||
    process.env.CLIENT_URL ||
    "http://localhost:3000";

  brokerLog("config", {
    hasClientId: Boolean(clientId),
    clientId: redactSecret(clientId),
    hasClientSecret: Boolean(clientSecret),
    redirectUri,
    clientOrigin,
  });

  if (!clientId || !clientSecret || !redirectUri) {
    throw httpError(
      "cTrader is not configured. CTRADER_CLIENT_ID, CTRADER_CLIENT_SECRET, and CTRADER_REDIRECT_URI are required.",
      500,
    );
  }

  return { clientId, clientSecret, redirectUri, clientOrigin };
}

function getFrontendBrokerUrl(clientOrigin, query) {
  const url = new URL("/home/accounts/broker", clientOrigin);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value != null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;

  const parts = header.split(";");
  for (const part of parts) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

function setOAuthCookie(res, state) {
  res.cookie(OAUTH_COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    path: "/",
    maxAge: 15 * 60 * 1000,
  });
}

function clearOAuthCookie(res) {
  res.clearCookie(OAUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "none",
    secure: true,
    path: "/",
  });
}

function resolveOAuthState({ state, req }) {
  const cookieState = readCookie(req, OAUTH_COOKIE_NAME);
  const rawState = state || cookieState;

  brokerLog("oauth-state:resolve", {
    hasQueryState: Boolean(state),
    hasCookieState: Boolean(cookieState),
    queryState: redactSecret(state),
    cookieState: redactSecret(cookieState),
  });

  if (!rawState) return null;

  try {
    const decoded = verifyOAuthState(rawState);
    brokerLog("oauth-state:verified", {
      userId: decoded.sub,
      connectionId: decoded.cid,
      source: state ? "query" : "cookie",
    });
    return decoded;
  } catch (error) {
    brokerWarn("oauth-state:invalid", {
      message: error.message,
      rawState: redactSecret(rawState),
    });
    return null;
  }
}

async function startCTraderConnect(user) {
  const userId = getUserId(user);
  brokerLog("connect:start", { userId });

  if (!userId) {
    throw httpError("User is not signed in.", 401);
  }

  const { clientId, redirectUri } = getCTraderConfig();

  const pending = await BrokerConnection.create({
    userId,
    provider: "ctrader",
    platform: "ctrader",
    status: "connecting",
  });

  brokerLog("connect:pending-created", {
    connectionId: String(pending._id),
    userId: String(userId),
    status: pending.status,
  });

  const state = signOAuthState({
    sub: String(userId),
    cid: String(pending._id),
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "accounts",
    product: "web",
    state,
  });

  const authorizationUrl = `${CTRADER_AUTHORIZE_URL}?${params.toString()}`;

  brokerLog("connect:authorization-url", {
    host: CTRADER_AUTHORIZE_URL,
    redirectUri,
    scope: "accounts",
    hasState: true,
  });

  return {
    authorizationUrl,
    state,
    connectionId: String(pending._id),
  };
}

async function exchangeCTraderCode(code) {
  const { clientId, clientSecret, redirectUri } = getCTraderConfig();

  const tokenUrl = new URL(CTRADER_TOKEN_URL);
  tokenUrl.searchParams.set("grant_type", "authorization_code");
  tokenUrl.searchParams.set("code", code);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("client_id", clientId);
  tokenUrl.searchParams.set("client_secret", clientSecret);

  brokerLog("token-exchange:request", {
    url: `${tokenUrl.origin}${tokenUrl.pathname}`,
    grantType: "authorization_code",
    redirectUri,
    clientId: redactSecret(clientId),
    code: redactSecret(code),
  });

  const response = await fetch(tokenUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  const rawBody = await response.text();
  let payload = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    brokerError("token-exchange:invalid-json", error, {
      status: response.status,
      body: rawBody?.slice(0, 500),
    });
    throw httpError("cTrader returned an invalid token response.", 502);
  }

  brokerLog("token-exchange:response", {
    httpStatus: response.status,
    ok: response.ok,
    tokenType: payload.tokenType,
    expiresIn: payload.expiresIn,
    errorCode: payload.errorCode,
    description: payload.description,
    hasAccessToken: Boolean(payload.accessToken),
    hasRefreshToken: Boolean(payload.refreshToken),
    accessToken: redactSecret(payload.accessToken),
    refreshToken: redactSecret(payload.refreshToken),
  });

  if (!response.ok || payload.errorCode || !payload.accessToken) {
    throw httpError(
      payload.description ||
        payload.errorCode ||
        "Failed to exchange the cTrader authorization code.",
      400,
    );
  }

  const expiresInMs = Number(payload.expiresIn || 2628000) * 1000;

  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    tokenExpiresAt: new Date(Date.now() + expiresInMs),
  };
}

async function saveCTraderTokens({ userId, connectionId, tokens }) {
  brokerLog("connection:save:start", {
    userId: userId ? String(userId) : null,
    connectionId: connectionId || null,
  });

  let connection = null;

  if (connectionId && userId) {
    connection = await BrokerConnection.findOne({
      _id: connectionId,
      userId,
      provider: "ctrader",
    });
  }

  if (!connection && userId) {
    connection = await BrokerConnection.findOne({
      userId,
      provider: "ctrader",
    }).sort({ updatedAt: -1 });
  }

  if (!connection && userId) {
    connection = new BrokerConnection({
      userId,
      provider: "ctrader",
      platform: "ctrader",
    });
  }

  if (!connection) {
    throw httpError(
      "Could not match the cTrader callback to a signed-in Juvo user. Start the connection again from Broker Connections.",
      401,
    );
  }

  let snapshot = null;
  try {
    const { clientId, clientSecret } = getCTraderConfig();
    snapshot = await getCTraderReadOnlySnapshot(tokens.accessToken, {
      clientId,
      clientSecret,
    });
  } catch (error) {
    brokerError("connection:accounts:error", error, {
      userId: userId ? String(userId) : null,
      connectionId: connectionId || null,
    });
    throw httpError(
      error.message ||
        "cTrader OAuth succeeded, but JUVO could not retrieve the authorized account list.",
      error.status || 502,
    );
  }

  const accounts = snapshot.accounts || [];
  const primaryAccount = snapshot.selectedAccount || accounts[0] || null;

  if (!primaryAccount?.ctidTraderAccountId) {
    throw httpError(
      "cTrader returned no authorized trading accounts for this access token.",
      400,
    );
  }

  const tradingAccount = await upsertTradingAccountFromCTrader({
    userId,
    snapshot,
  });
  const positionSync = await syncCTraderOpenPositions({
    userId,
    brokerConnectionId: connection._id,
    tradingAccount,
    snapshot,
  });
  const importSummary = await importCTraderClosedDeals({
    userId,
    tradingAccount,
    snapshot,
  });

  connection.provider = "ctrader";
  connection.platform = "ctrader";
  connection.externalAccountId = primaryAccount?.ctidTraderAccountId;
  connection.accountNumber =
    snapshot.trader?.traderLogin || primaryAccount?.ctidTraderAccountId;
  connection.brokerName = getBrokerTitle(primaryAccount, snapshot.trader);
  connection.accountType =
    typeof primaryAccount?.isLive === "boolean"
      ? primaryAccount.isLive
        ? "live"
        : "demo"
      : undefined;
  connection.accessToken = tokens.accessToken;
  connection.refreshToken = tokens.refreshToken;
  connection.tokenExpiresAt = tokens.tokenExpiresAt;
  connection.status = "connected";
  connection.connectedAt = new Date();
  connection.lastSyncedAt = new Date();

  await connection.save();

  if (userId) {
    await BrokerConnection.updateMany(
      {
        userId,
        provider: "ctrader",
        status: "connecting",
        _id: { $ne: connection._id },
      },
      { $set: { status: "disconnected" } },
    );
  }

  brokerLog("connection:save:done", {
    connectionId: String(connection._id),
    userId: String(connection.userId),
    status: connection.status,
    tokenExpiresAt: connection.tokenExpiresAt,
    ctidTraderAccountIds: accounts.map((account) => account.ctidTraderAccountId),
    tradingAccountId: String(tradingAccount._id),
    importedTrades: importSummary.imported,
    skippedDeals: importSummary.skipped,
    openPositions: positionSync.upserted,
    closedPositions: positionSync.markedClosed,
  });

  cTraderManager.registerBrokerConnection(connection._id).catch((error) => {
    brokerError("ctrader:manager:register-after-oauth:error", error, {
      connectionId: String(connection._id),
    });
  });

  return {
    ...connection.toJSON(),
    ctidTraderAccounts: accounts.map(({ ctidTraderAccountId, isLive, brokerTitle }) => ({
      ctidTraderAccountId,
      isLive,
      brokerTitle,
    })),
    tradingAccountId: String(tradingAccount._id),
    sync: {
      importedTrades: importSummary.imported,
      skippedDeals: importSummary.skipped,
      openPositions: positionSync.upserted,
      closedPositions: positionSync.markedClosed,
      pendingOrders: snapshot.orders.length,
      hasMoreDeals: snapshot.hasMoreDeals,
    },
  };
}

async function listBrokerPositions(user, filters = {}) {
  const userId = getUserId(user);
  brokerLog("positions:list", {
    userId: userId ? String(userId) : null,
    status: filters.status,
  });

  if (!userId) {
    throw httpError("User is not signed in.", 401);
  }

  const query = { userId };
  if (filters.status) query.status = String(filters.status).toLowerCase();
  if (filters.tradingAccount) query.tradingAccount = filters.tradingAccount;

  const positions = await BrokerPosition.find(query)
    .populate("tradingAccount", "accountName accountNumber broker platform currency")
    .sort({ status: 1, openedAt: -1, updatedAt: -1 })
    .lean();

  brokerLog("positions:list:done", { count: positions.length });
  return positions;
}

async function syncCTraderConnection(user, connectionId) {
  const userId = getUserId(user);
  brokerLog("ctrader:sync:start", {
    userId: userId ? String(userId) : null,
    connectionId: connectionId || null,
  });

  if (!userId) {
    throw httpError("User is not signed in.", 401);
  }

  const query = {
    userId,
    provider: "ctrader",
    status: "connected",
  };
  if (connectionId) query._id = connectionId;

  const connection = await BrokerConnection.findOne(query)
    .sort({ updatedAt: -1 })
    .select("+accessToken +refreshToken");

  if (!connection) {
    throw httpError("Connected cTrader broker connection not found.", 404);
  }

  const accessToken = connection.getAccessToken();
  if (!accessToken) {
    throw httpError("cTrader access token is missing for this connection.", 401);
  }

  const { clientId, clientSecret } = getCTraderConfig();
  const snapshot = await getCTraderReadOnlySnapshot(accessToken, {
    clientId,
    clientSecret,
    ctidTraderAccountId: connection.externalAccountId,
  });

  const tradingAccount = await upsertTradingAccountFromCTrader({
    userId,
    snapshot,
  });
  const positionSync = await syncCTraderOpenPositions({
    userId,
    brokerConnectionId: connection._id,
    tradingAccount,
    snapshot,
  });
  const importSummary = await importCTraderClosedDeals({
    userId,
    tradingAccount,
    snapshot,
  });

  connection.externalAccountId = snapshot.selectedAccount.ctidTraderAccountId;
  connection.accountNumber =
    snapshot.trader?.traderLogin || snapshot.selectedAccount.ctidTraderAccountId;
  connection.brokerName = getBrokerTitle(snapshot.selectedAccount, snapshot.trader);
  connection.accountType = snapshot.selectedAccount.isLive ? "live" : "demo";
  connection.lastSyncedAt = new Date();
  await connection.save();

  brokerLog("ctrader:sync:done", {
    connectionId: String(connection._id),
    tradingAccountId: String(tradingAccount._id),
    importedTrades: importSummary.imported,
    skippedDeals: importSummary.skipped,
    openPositions: positionSync.upserted,
    closedPositions: positionSync.markedClosed,
  });

  return {
    connection: connection.toJSON(),
    tradingAccountId: String(tradingAccount._id),
    importedTrades: importSummary.imported,
    skippedDeals: importSummary.skipped,
    openPositions: positionSync.upserted,
    closedPositions: positionSync.markedClosed,
    pendingOrders: snapshot.orders.length,
    hasMoreDeals: snapshot.hasMoreDeals,
  };
}

function getCallbackIdentity({ code, state, error, errorDescription, req }) {
  brokerLog("callback:start", {
    hasCode: Boolean(code),
    code: redactSecret(code),
    hasState: Boolean(state),
    error: error || null,
    errorDescription: errorDescription || null,
    query: req?.query,
  });

  if (error) {
    throw httpError(errorDescription || error || "cTrader denied access.", 400);
  }

  if (!code) {
    throw httpError("Missing cTrader authorization code.", 400);
  }

  return resolveOAuthState({ state, req });
}

async function completeCTraderCallback({
  code,
  state,
  error,
  errorDescription,
  req,
}) {
  const decodedState = getCallbackIdentity({
    code,
    state,
    error,
    errorDescription,
    req,
  });

  if (!decodedState?.sub) {
    const error = httpError(
      "Could not match the cTrader callback to a signed-in Juvo user.",
      401,
    );
    error.code = "BROKER_STATE_MISSING";
    throw error;
  }

  const tokens = await exchangeCTraderCode(code);
  return saveCTraderTokens({
    userId: decodedState.sub,
    connectionId: decodedState.cid,
    tokens,
  });
}

async function completeCTraderConnectForUser({ user, code }) {
  const userId = getUserId(user);
  brokerLog("callback:authenticated", {
    userId: userId ? String(userId) : null,
    code: redactSecret(code),
  });

  if (!userId) {
    throw httpError("User is not signed in.", 401);
  }

  if (!code) {
    throw httpError("Missing cTrader authorization code.", 400);
  }

  const tokens = await exchangeCTraderCode(code);
  return saveCTraderTokens({ userId, tokens });
}

async function listBrokerConnections(user) {
  const userId = getUserId(user);
  brokerLog("connections:list", { userId: userId ? String(userId) : null });

  if (!userId) {
    throw httpError("User is not signed in.", 401);
  }

  const connections = await BrokerConnection.find({ userId }).sort({
    updatedAt: -1,
  });

  brokerLog("connections:list:done", { count: connections.length });
  return connections.map((connection) => connection.toJSON());
}

export {
  startCTraderConnect,
  completeCTraderCallback,
  completeCTraderConnectForUser,
  listBrokerConnections,
  listBrokerPositions,
  syncCTraderConnection,
  getCTraderConfig,
  getFrontendBrokerUrl,
  setOAuthCookie,
  clearOAuthCookie,
  getCallbackIdentity,
};
