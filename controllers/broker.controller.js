import {
  clearOAuthCookie,
  completeCTraderCallback,
  completeCTraderConnectForUser,
  getCallbackIdentity,
  getCTraderConfig,
  getFrontendBrokerUrl,
  listBrokerConnections,
  setOAuthCookie,
  startCTraderConnect,
} from "../services/broker.service.js";
import { brokerError, brokerLog, brokerWarn } from "../utils/brokerDebug.js";

function redirectToBrokerPage(res, query) {
  const { clientOrigin } = getCTraderConfig();
  const location = getFrontendBrokerUrl(clientOrigin, query);
  brokerLog("callback:redirect", { location });
  clearOAuthCookie(res);
  return res.redirect(location);
}

export async function connectCTrader(req, res, next) {
  brokerLog("controller:connect:hit", {
    userId: req.user?.id || req.user?._id,
    query: req.query,
  });

  try {
    const result = await startCTraderConnect(req.user);
    setOAuthCookie(res, result.state);

    brokerLog("controller:connect:ok", {
      connectionId: result.connectionId,
      hasAuthorizationUrl: Boolean(result.authorizationUrl),
      cookie: "juvo_ctrader_oauth set (httpOnly, SameSite=None)",
    });

    return res.status(200).json({
      message: "Redirect to cTrader to grant Juvo access.",
      authorizationUrl: result.authorizationUrl,
    });
  } catch (error) {
    brokerError("controller:connect:error", error);
    next(error);
  }
}

export async function callbackCTrader(req, res, next) {
  brokerLog("controller:callback:hit", {
    method: req.method,
    path: req.originalUrl,
    query: req.query,
    hasCookieHeader: Boolean(req.headers.cookie),
    bodyKeys: req.body ? Object.keys(req.body) : [],
  });

  try {
    const code = req.query.code || req.body?.code;
    const state = req.query.state || req.body?.state;
    const error = req.query.error || req.body?.error;
    const errorDescription =
      req.query.error_description || req.body?.error_description;

    const identity = getCallbackIdentity({
      code,
      state,
      error,
      errorDescription,
      req,
    });

    if (!identity?.sub && code) {
      brokerWarn("controller:callback:forward-code-to-client", {
        reason: "oauth state/cookie did not identify the user",
      });
      return redirectToBrokerPage(res, { code });
    }

    await completeCTraderCallback({
      code,
      state,
      error,
      errorDescription,
      req,
    });

    return redirectToBrokerPage(res, { connected: "1" });
  } catch (error) {
    brokerError("controller:callback:error", error, {
      query: req.query,
    });

    try {
      return redirectToBrokerPage(res, {
        error: error.message || "cTrader connection failed.",
      });
    } catch (redirectError) {
      brokerError("controller:callback:redirect-failed", redirectError);
      next(error);
    }
  }
}

export async function completeCTrader(req, res, next) {
  brokerLog("controller:complete:hit", {
    userId: req.user?.id || req.user?._id,
    hasCode: Boolean(req.body?.code || req.query.code),
  });

  try {
    const code = req.body?.code || req.query.code;
    const connection = await completeCTraderConnectForUser({
      user: req.user,
      code,
    });

    return res.status(200).json({
      message: "cTrader connected successfully.",
      data: connection,
    });
  } catch (error) {
    brokerError("controller:complete:error", error);
    next(error);
  }
}

export async function getBrokerConnections(req, res, next) {
  brokerLog("controller:list:hit", {
    userId: req.user?.id || req.user?._id,
  });

  try {
    const connections = await listBrokerConnections(req.user);
    return res.status(200).json({
      message: connections.length
        ? "Broker connections retrieved successfully."
        : "No broker connections found.",
      data: connections,
    });
  } catch (error) {
    brokerError("controller:list:error", error);
    next(error);
  }
}
