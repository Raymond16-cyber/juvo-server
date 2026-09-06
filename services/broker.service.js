import BrokerConnection from "../models/Broker.model.js";
import { signOAuthState, verifyOAuthState } from "../utils/token.js";
import {
  brokerError,
  brokerLog,
  brokerWarn,
  redactSecret,
} from "../utils/brokerDebug.js";
import { getCTraderAccountsByAccessToken } from "../brokers/ctrader/ctrader.service.js";

const CTRADER_AUTHORIZE_URL =
  "https://id.ctrader.com/my/settings/openapi/grantingaccess/";
const CTRADER_TOKEN_URL = "https://openapi.ctrader.com/apps/token";
const OAUTH_COOKIE_NAME = "juvo_ctrader_oauth";

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getUserId(user) {
  return user?.id || user?._id;
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

  let accounts = [];
  try {
    const { clientId, clientSecret } = getCTraderConfig();
    accounts = await getCTraderAccountsByAccessToken(tokens.accessToken, {
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

  const primaryAccount = accounts[0] || null;

  if (!primaryAccount?.ctidTraderAccountId) {
    throw httpError(
      "cTrader returned no authorized trading accounts for this access token.",
      400,
    );
  }

  connection.provider = "ctrader";
  connection.platform = "ctrader";
  connection.externalAccountId = primaryAccount?.ctidTraderAccountId;
  connection.accountNumber =
    primaryAccount?.accountNumber || primaryAccount?.ctidTraderAccountId;
  connection.brokerName = primaryAccount?.brokerTitle || "cTrader";
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
  });

  return {
    ...connection.toJSON(),
    ctidTraderAccounts: accounts.map(({ ctidTraderAccountId, isLive, brokerTitle }) => ({
      ctidTraderAccountId,
      isLive,
      brokerTitle,
    })),
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
  getCTraderConfig,
  getFrontendBrokerUrl,
  setOAuthCookie,
  clearOAuthCookie,
  getCallbackIdentity,
};
