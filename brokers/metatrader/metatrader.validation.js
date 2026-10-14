import { connectorError } from "./metatrader.security.js";
const fail = () => { throw connectorError("PAYLOAD", "Invalid connector payload."); };
const object = (v) => v && typeof v === "object" && !Array.isArray(v);
export function fields(value, allowed) {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail();
}
export function text(value, max = 128) { if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) fail(); return value; }
export function ticket(value) { if (typeof value !== "string" || !/^[0-9]{1,20}$/.test(value)) fail(); return value; }
export function number(value, min = -1e15, max = 1e15) { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(); return value; }
export function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) { number(value, min, max); if (!Number.isSafeInteger(value)) fail(); return value; }
export function timestamp(value) { integer(value, 0, Date.now() + 86400000); return value; }
export function validateAccount(value) {
  fields(value, ["login", "server", "broker", "currency", "type", "leverage", "balance", "equity", "margin", "freeMargin"]);
  ticket(value.login); text(value.server); text(value.broker); text(value.currency, 8);
  if (!/^[A-Z]{3,8}$/.test(value.currency) || !["ACCOUNT_TRADE_MODE_DEMO", "ACCOUNT_TRADE_MODE_REAL", "ACCOUNT_TRADE_MODE_CONTEST"].includes(value.type)) fail();
  for (const key of ["balance", "equity", "margin", "freeMargin"]) number(value[key]);
  integer(value.leverage, 1, 1000000);
  return value;
}
const common = ["protocolVersion", "connectorVersion", "accountKey", "timestamp"];
export function validateEnvelope(value, extra = []) {
  fields(value, [...common, ...extra]);
  if (value.protocolVersion !== 1) throw connectorError("PROTOCOL", "Update JUVO Connector: protocol version 1 is required.", 426);
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value.connectorVersion || "")) fail();
  timestamp(value.timestamp);
  if (!/^[a-f0-9]{64}$/.test(value.accountKey || "")) fail();
}
export function validatePosition(value) {
  fields(value, ["id", "ticket", "symbol", "type", "volume", "openPrice", "currentPrice", "stopLoss", "takeProfit", "profit", "swap", "magic", "comment", "time", "updateTime", "reason"]);
  ticket(value.id); ticket(value.ticket); text(value.symbol, 64); if (value.comment) text(value.comment, 256);
  if (!["POSITION_TYPE_BUY", "POSITION_TYPE_SELL"].includes(value.type) || !/^POSITION_REASON_(CLIENT|MOBILE|WEB|EXPERT|UNKNOWN)$/.test(value.reason)) fail();
  for (const key of ["openPrice", "currentPrice"]) number(value[key]);
  number(value.volume, Number.MIN_VALUE, 1e9); number(value.profit); number(value.swap); ticket(value.magic);
  timestamp(value.time); timestamp(value.updateTime);
  for (const key of ["stopLoss", "takeProfit"]) if (value[key] !== undefined) number(value[key]);
  return value;
}
export function validateHistoryRecord(value, kind) {
  const allowed = ["id", "positionId", "orderId", "symbol", "type", "entryType", "volume", "price", "openPrice", "profit", "commission", "swap", "fee", "magic", "comment", "time", "doneTime", "reason", "state", "stopLoss", "takeProfit"];
  fields(value, allowed); ticket(value.id); ticket(value.positionId); ticket(value.magic);
  timestamp(value.time); text(value.type, 64); text(value.reason, 64);
  if (value.symbol) text(value.symbol, 64);
  if (value.comment) text(value.comment, 256);
  if (value.orderId !== undefined) ticket(value.orderId);
  if (kind === "deal") {
    if (!/^DEAL_TYPE_[A-Z_]+$/.test(value.type) || !["DEAL_ENTRY_IN", "DEAL_ENTRY_OUT", "DEAL_ENTRY_INOUT", "DEAL_ENTRY_OUT_BY"].includes(value.entryType)) fail();
    for (const key of ["volume", "price", "profit", "commission", "swap", "fee"]) number(value[key]);
    number(value.volume, 0, 1e9);
  } else {
    if (!/^ORDER_TYPE_[A-Z_]+$/.test(value.type)) fail();
    text(value.state, 64); number(value.volume, 0, 1e9); timestamp(value.doneTime);
  }
  for (const key of ["openPrice", "stopLoss", "takeProfit"]) if (value[key] !== undefined) number(value[key]);
  return value;
}
export function array(value, max) { if (!Array.isArray(value) || value.length > max) fail(); return value; }
