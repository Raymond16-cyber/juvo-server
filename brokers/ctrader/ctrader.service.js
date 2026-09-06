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

async function getCTraderAccountsByAccessToken(
  accessToken,
  { clientId, clientSecret },
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

    brokerLog("ctrader:accounts:start", {
      hasAccessToken: Boolean(accessToken),
    });

    const response = await socket.sendRequest(
      CTRADER_PAYLOAD_TYPES.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ,
      { accessToken },
      {
        expectedPayloadType:
          CTRADER_PAYLOAD_TYPES.GET_ACCOUNTS_BY_ACCESS_TOKEN_RES,
        timeoutMs: CTRADER_SOCKET_TIMEOUT_MS,
      },
    );

    const accounts = extractAccountsFromResponse(response);
    const safeAccounts = accounts.map(({ ctidTraderAccountId }) => ({
      ctidTraderAccountId,
    }));

    brokerLog("ctrader:accounts:success", {
      count: accounts.length,
      accounts: safeAccounts,
    });

    console.log(safeAccounts);
    console.log("🔥 SUCCESS");

    return accounts;
  } finally {
    socket.close();
  }
}

export {
  authenticateCTraderApplication,
  extractAccountsFromResponse,
  getCTraderAccountsByAccessToken,
};
