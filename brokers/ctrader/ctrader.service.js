import { brokerLog } from "../../utils/brokerDebug.js";
import {
  CTRADER_PAYLOAD_TYPES,
  CTRADER_SOCKET_TIMEOUT_MS,
} from "./ctrader.constants.js";
import { createCTraderSocket } from "./ctrader.socket.js";

function normalizeCtidAccount(account) {
  if (account == null) return null;

  if (typeof account === "string" || typeof account === "number") {
    return { ctidTraderAccountId: String(account) };
  }

  const ctidTraderAccountId =
    account.ctidTraderAccountId ??
    account.ctidTraderAccountID ??
    account.id ??
    account.accountId;

  if (ctidTraderAccountId == null) return null;

  return {
    ctidTraderAccountId: String(ctidTraderAccountId),
    isLive: account.isLive,
    brokerTitle: account.brokerTitle,
    accountNumber: account.accountNumber,
  };
}

function extractAccountsFromResponse(response) {
  const rawAccounts = response?.payload?.ctidTraderAccount;
  const accounts = Array.isArray(rawAccounts) ? rawAccounts : [];

  return accounts.map(normalizeCtidAccount).filter(Boolean);
}

function toCTraderAccountId(value) {
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) ? numericValue : String(value);
}

async function authenticateCTraderApplication(socket, { clientId, clientSecret }) {
  brokerLog("ctrader:application-auth:start", {
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
  });

  const response = await socket.sendRequest(
    CTRADER_PAYLOAD_TYPES.APPLICATION_AUTH_REQ,
    { clientId, clientSecret },
    {
      expectedPayloadType: CTRADER_PAYLOAD_TYPES.APPLICATION_AUTH_RES,
      timeoutMs: CTRADER_SOCKET_TIMEOUT_MS,
    },
  );

  brokerLog("ctrader:application-auth:success", {
    payloadType: response.payloadType,
  });

  return response;
}

async function authorizeCTraderAccount(socket, { ctidTraderAccountId, accessToken }) {
  brokerLog("ctrader:account-auth:start", {
    ctidTraderAccountId: String(ctidTraderAccountId),
    hasAccessToken: Boolean(accessToken),
  });

  const response = await socket.sendRequest(
    CTRADER_PAYLOAD_TYPES.ACCOUNT_AUTH_REQ,
    {
      ctidTraderAccountId: toCTraderAccountId(ctidTraderAccountId),
      accessToken,
    },
    {
      expectedPayloadType: CTRADER_PAYLOAD_TYPES.ACCOUNT_AUTH_RES,
      timeoutMs: CTRADER_SOCKET_TIMEOUT_MS,
    },
  );

  brokerLog("ctrader:account-auth:success", {
    ctidTraderAccountId: String(response.payload?.ctidTraderAccountId),
  });

  return response;
}

async function requestCTraderAccounts(socket, accessToken) {
  brokerLog("ctrader:accounts:start", {
    hasAccessToken: Boolean(accessToken),
  });

  const response = await socket.sendRequest(
    CTRADER_PAYLOAD_TYPES.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ,
    { accessToken },
    {
      expectedPayloadType: CTRADER_PAYLOAD_TYPES.GET_ACCOUNTS_BY_ACCESS_TOKEN_RES,
      timeoutMs: CTRADER_SOCKET_TIMEOUT_MS,
    },
  );

  const accounts = extractAccountsFromResponse(response);
  brokerLog("ctrader:accounts:success", {
    count: accounts.length,
    accounts: accounts.map(({ ctidTraderAccountId }) => ({
      ctidTraderAccountId,
    })),
  });

  return accounts;
}

async function requestTrader(socket, ctidTraderAccountId) {
  const response = await socket.sendRequest(
    CTRADER_PAYLOAD_TYPES.TRADER_REQ,
    { ctidTraderAccountId: toCTraderAccountId(ctidTraderAccountId) },
    {
      expectedPayloadType: CTRADER_PAYLOAD_TYPES.TRADER_RES,
      timeoutMs: CTRADER_SOCKET_TIMEOUT_MS,
    },
  );

  brokerLog("ctrader:trader:success", {
    ctidTraderAccountId: String(ctidTraderAccountId),
    hasTrader: Boolean(response.payload?.trader),
  });

  return response.payload?.trader || null;
}

async function requestAssets(socket, ctidTraderAccountId) {
  const response = await socket.sendRequest(
    CTRADER_PAYLOAD_TYPES.ASSET_LIST_REQ,
    { ctidTraderAccountId: toCTraderAccountId(ctidTraderAccountId) },
    {
      expectedPayloadType: CTRADER_PAYLOAD_TYPES.ASSET_LIST_RES,
      timeoutMs: CTRADER_SOCKET_TIMEOUT_MS,
    },
  );

  const assets = Array.isArray(response.payload?.asset)
    ? response.payload.asset
    : [];

  brokerLog("ctrader:assets:success", {
    ctidTraderAccountId: String(ctidTraderAccountId),
    count: assets.length,
  });

  return assets;
}

async function requestSymbols(socket, ctidTraderAccountId) {
  const response = await socket.sendRequest(
    CTRADER_PAYLOAD_TYPES.SYMBOLS_LIST_REQ,
    {
      ctidTraderAccountId: toCTraderAccountId(ctidTraderAccountId),
      includeArchivedSymbols: true,
    },
    {
      expectedPayloadType: CTRADER_PAYLOAD_TYPES.SYMBOLS_LIST_RES,
      timeoutMs: CTRADER_SOCKET_TIMEOUT_MS,
    },
  );

  const symbols = Array.isArray(response.payload?.symbol)
    ? response.payload.symbol
    : [];
  const archivedSymbols = Array.isArray(response.payload?.archivedSymbol)
    ? response.payload.archivedSymbol
    : [];

  brokerLog("ctrader:symbols:success", {
    ctidTraderAccountId: String(ctidTraderAccountId),
    symbols: symbols.length,
    archivedSymbols: archivedSymbols.length,
  });

  return { symbols, archivedSymbols };
}

async function requestSymbolById(socket, ctidTraderAccountId, symbolIds = []) {
  const uniqueSymbolIds = Array.from(
    new Set(symbolIds.map((symbolId) => Number(symbolId)).filter(Boolean)),
  );
  if (!uniqueSymbolIds.length) return { symbols: [], archivedSymbols: [] };

  const response = await socket.sendRequest(
    CTRADER_PAYLOAD_TYPES.SYMBOL_BY_ID_REQ,
    {
      ctidTraderAccountId: toCTraderAccountId(ctidTraderAccountId),
      symbolId: uniqueSymbolIds,
    },
    {
      expectedPayloadType: CTRADER_PAYLOAD_TYPES.SYMBOL_BY_ID_RES,
      timeoutMs: CTRADER_SOCKET_TIMEOUT_MS,
    },
  );

  const symbols = Array.isArray(response.payload?.symbol)
    ? response.payload.symbol
    : [];
  const archivedSymbols = Array.isArray(response.payload?.archivedSymbol)
    ? response.payload.archivedSymbol
    : [];

  brokerLog("ctrader:symbol-by-id:success", {
    ctidTraderAccountId: String(ctidTraderAccountId),
    requested: uniqueSymbolIds.length,
    symbols: symbols.length,
    archivedSymbols: archivedSymbols.length,
  });

  return { symbols, archivedSymbols };
}

async function requestReconcile(socket, ctidTraderAccountId) {
  const response = await socket.sendRequest(
    CTRADER_PAYLOAD_TYPES.RECONCILE_REQ,
    {
      ctidTraderAccountId: toCTraderAccountId(ctidTraderAccountId),
      returnProtectionOrders: false,
    },
    {
      expectedPayloadType: CTRADER_PAYLOAD_TYPES.RECONCILE_RES,
      timeoutMs: CTRADER_SOCKET_TIMEOUT_MS,
    },
  );

  const positions = Array.isArray(response.payload?.position)
    ? response.payload.position
    : [];
  const orders = Array.isArray(response.payload?.order)
    ? response.payload.order
    : [];

  brokerLog("ctrader:reconcile:success", {
    ctidTraderAccountId: String(ctidTraderAccountId),
    openPositions: positions.length,
    pendingOrders: orders.length,
  });

  return { positions, orders };
}

async function requestDeals(socket, ctidTraderAccountId, options = {}) {
  const now = Date.now();
  const fromTimestamp =
    options.fromTimestamp ??
    now - Number(process.env.CTRADER_INITIAL_SYNC_DAYS || 90) * 24 * 60 * 60 * 1000;
  const toTimestamp = options.toTimestamp ?? now;
  const maxRows = Number(options.maxRows || process.env.CTRADER_DEAL_SYNC_MAX_ROWS || 200);

  const response = await socket.sendRequest(
    CTRADER_PAYLOAD_TYPES.DEAL_LIST_REQ,
    {
      ctidTraderAccountId: toCTraderAccountId(ctidTraderAccountId),
      fromTimestamp,
      toTimestamp,
      maxRows,
    },
    {
      expectedPayloadType: CTRADER_PAYLOAD_TYPES.DEAL_LIST_RES,
      timeoutMs: CTRADER_SOCKET_TIMEOUT_MS,
    },
  );

  const deals = Array.isArray(response.payload?.deal) ? response.payload.deal : [];

  brokerLog("ctrader:deals:success", {
    ctidTraderAccountId: String(ctidTraderAccountId),
    count: deals.length,
    hasMore: Boolean(response.payload?.hasMore),
    fromTimestamp,
    toTimestamp,
    maxRows,
  });

  return {
    deals,
    hasMore: Boolean(response.payload?.hasMore),
    fromTimestamp,
    toTimestamp,
  };
}

async function requestPositionUnrealizedPnl(socket, ctidTraderAccountId) {
  const response = await socket.sendRequest(
    CTRADER_PAYLOAD_TYPES.GET_POSITION_UNREALIZED_PNL_REQ,
    {
      ctidTraderAccountId: toCTraderAccountId(ctidTraderAccountId),
    },
    {
      expectedPayloadType: CTRADER_PAYLOAD_TYPES.GET_POSITION_UNREALIZED_PNL_RES,
      timeoutMs: CTRADER_SOCKET_TIMEOUT_MS,
    },
  );

  const values = Array.isArray(response.payload?.positionUnrealizedPnL)
    ? response.payload.positionUnrealizedPnL
    : [];

  brokerLog("ctrader:unrealized-pnl:success", {
    ctidTraderAccountId: String(ctidTraderAccountId),
    count: values.length,
  });

  return {
    moneyDigits: response.payload?.moneyDigits ?? 2,
    values,
  };
}

async function getCTraderReadOnlySnapshot(
  accessToken,
  { clientId, clientSecret, ctidTraderAccountId } = {},
) {
  if (!accessToken) {
    const error = new Error("Missing cTrader access token.");
    error.status = 401;
    throw error;
  }

  const socket = createCTraderSocket();

  try {
    await socket.connect();
    await authenticateCTraderApplication(socket, { clientId, clientSecret });

    const accounts = await requestCTraderAccounts(socket, accessToken);
    const selectedAccount =
      accounts.find(
        (account) =>
          String(account.ctidTraderAccountId) === String(ctidTraderAccountId),
      ) ||
      accounts[0] ||
      null;

    if (!selectedAccount?.ctidTraderAccountId) {
      const error = new Error(
        "cTrader returned no authorized trading accounts for this access token.",
      );
      error.status = 400;
      throw error;
    }

    await authorizeCTraderAccount(socket, {
      ctidTraderAccountId: selectedAccount.ctidTraderAccountId,
      accessToken,
    });

    const [trader, assets, symbolsResult, reconcile, dealsResult] =
      await Promise.all([
        requestTrader(socket, selectedAccount.ctidTraderAccountId),
        requestAssets(socket, selectedAccount.ctidTraderAccountId),
        requestSymbols(socket, selectedAccount.ctidTraderAccountId),
        requestReconcile(socket, selectedAccount.ctidTraderAccountId),
        requestDeals(socket, selectedAccount.ctidTraderAccountId),
      ]);
    const openSymbolIds = Array.from(
      new Set(
        [
          ...(reconcile.positions || []).map(
            (position) => position?.tradeData?.symbolId,
          ),
          ...(dealsResult.deals || []).map((deal) => deal?.symbolId),
        ].filter(Boolean),
      ),
    );
    const detailedSymbols = await requestSymbolById(
      socket,
      selectedAccount.ctidTraderAccountId,
      openSymbolIds,
    );

    return {
      accounts,
      selectedAccount,
      trader,
      assets,
      symbols: symbolsResult.symbols,
      archivedSymbols: symbolsResult.archivedSymbols,
      detailedSymbols: detailedSymbols.symbols,
      detailedArchivedSymbols: detailedSymbols.archivedSymbols,
      positions: reconcile.positions,
      orders: reconcile.orders,
      deals: dealsResult.deals,
      hasMoreDeals: dealsResult.hasMore,
      syncWindow: {
        fromTimestamp: dealsResult.fromTimestamp,
        toTimestamp: dealsResult.toTimestamp,
      },
    };
  } finally {
    socket.close();
  }
}

async function getCTraderAccountsByAccessToken(
  accessToken,
  { clientId, clientSecret },
) {
  const snapshot = await getCTraderReadOnlySnapshot(accessToken, {
    clientId,
    clientSecret,
  });
  return snapshot.accounts;
}

export {
  authenticateCTraderApplication,
  authorizeCTraderAccount,
  extractAccountsFromResponse,
  getCTraderAccountsByAccessToken,
  getCTraderReadOnlySnapshot,
  requestAssets,
  requestDeals,
  requestPositionUnrealizedPnl,
  requestReconcile,
  requestSymbolById,
  requestSymbols,
  requestTrader,
};
