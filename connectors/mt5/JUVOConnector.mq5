#property strict
#property version "1.00"
#property description "JUVO read-only MT5 journal connector. No trading operations."

input string ApiUrl = "";
input string PairingCode = "";
input bool AllowLocalHttp = false;
input bool DisconnectAndClear = false;
input int PositionIntervalSeconds = 2;
input int BrokerUtcOffsetMinutes = 9999; // 9999 detects the CURRENT server offset; see README for historical DST.

string origin, token, account_key, connection_id, storage, attempt, code_hash;
string pending_path, pending_body, last_positions, pending_positions, history_id;
long login, cursor = 0, requested = 0, history_start = 0, history_end = 0;
string server_name;
int lock_handle = INVALID_HANDLE, failures = 0, history_page = 0, history_pages = 0, offset_seconds = 0;
int history_deals = 0, history_orders = 0;
ulong retry_at = 0, heartbeat_at = 0, account_at = 0, positions_at = 0, history_at = 0;
bool history_dirty = true, account_dirty = true, force_positions = true, stopped = false, history_turn = false;

string Q(string value) {
   string out = "\"";
   for(int i = 0; i < StringLen(value); i++) {
      ushort c = StringGetCharacter(value, i);
      if(c == 34) out += "\\\"";
      else if(c == 92) out += "\\\\";
      else if(c < 32) out += StringFormat("\\u%04X", c);
      else out += ShortToString(c);
   }
   return out + "\"";
}
string I(long value) { return IntegerToString(value); }
string U(ulong value) { return StringFormat("%I64u", value); }
string N(double value) { return DoubleToString(value, 8); }
string Digest(string value) {
   uchar bytes[], key[], result[];
   int count = StringToCharArray(value, bytes, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(bytes, count - 1);
   if(CryptEncode(CRYPT_HASH_SHA256, bytes, key, result) <= 0) return "";
   string output = "";
   for(int i = 0; i < ArraySize(result); i++) output += StringFormat("%02x", result[i]);
   return output;
}
long UtcMillis(long server_millis) { return server_millis == 0 ? 0 : server_millis - (long)offset_seconds * 1000; }
string Envelope() {
   return "{\"protocolVersion\":1,\"connectorVersion\":\"1.0.0\",\"accountKey\":" + Q(account_key) + ",\"timestamp\":" + I((long)TimeGMT() * 1000);
}
string AccountJson() {
   return "{\"login\":" + Q(I(AccountInfoInteger(ACCOUNT_LOGIN))) + ",\"server\":" + Q(AccountInfoString(ACCOUNT_SERVER)) +
      ",\"broker\":" + Q(AccountInfoString(ACCOUNT_COMPANY)) + ",\"currency\":" + Q(AccountInfoString(ACCOUNT_CURRENCY)) +
      ",\"type\":" + Q(EnumToString((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE))) +
      ",\"leverage\":" + I(AccountInfoInteger(ACCOUNT_LEVERAGE)) + ",\"balance\":" + N(AccountInfoDouble(ACCOUNT_BALANCE)) +
      ",\"equity\":" + N(AccountInfoDouble(ACCOUNT_EQUITY)) + ",\"margin\":" + N(AccountInfoDouble(ACCOUNT_MARGIN)) +
      ",\"freeMargin\":" + N(AccountInfoDouble(ACCOUNT_MARGIN_FREE)) + "}";
}
bool SaveState() {
   int handle = FileOpen(storage + ".state", FILE_WRITE | FILE_TXT | FILE_ANSI, 0, CP_UTF8);
   if(handle == INVALID_HANDLE) { Print("JUVO: cannot save local connector state. Check terminal file permissions."); return false; }
   FileWrite(handle, token); FileWrite(handle, account_key); FileWrite(handle, connection_id);
   FileWrite(handle, I(cursor)); FileWrite(handle, attempt); FileWrite(handle, code_hash);
   FileFlush(handle); FileClose(handle); return true;
}
void LoadState() {
   int handle = FileOpen(storage + ".state", FILE_READ | FILE_TXT | FILE_ANSI, 0, CP_UTF8);
   if(handle == INVALID_HANDLE) return;
   token = FileReadString(handle); account_key = FileReadString(handle); connection_id = FileReadString(handle);
   cursor = StringToInteger(FileReadString(handle)); attempt = FileReadString(handle); code_hash = FileReadString(handle);
   FileClose(handle);
}
bool LocalOrigin(string value) {
   string host = StringSubstr(value, 7);
   int colon = StringFind(host, ":");
   if(colon >= 0) host = StringSubstr(host, 0, colon);
   return host == "localhost" || host == "127.0.0.1";
}
int OnInit() {
   if(MQLInfoInteger(MQL_TESTER)) { Print("JUVO: WebRequest requires a desktop terminal, not Strategy Tester."); return INIT_FAILED; }
   origin = ApiUrl;
   while(StringLen(origin) > 0 && StringSubstr(origin, StringLen(origin)-1) == "/") origin = StringSubstr(origin, 0, StringLen(origin)-1);
   bool https = StringFind(origin, "https://") == 0;
   bool local = AllowLocalHttp && StringFind(origin, "http://") == 0 && LocalOrigin(origin);
   int host_start = https ? 8 : 7;
   if((!https && !local) || StringLen(origin) <= host_start || StringFind(origin, "/", host_start) >= 0 ||
      StringFind(origin, "@") >= 0 || StringFind(origin, "?") >= 0 || StringFind(origin, "#") >= 0 || StringFind(origin, "\\") >= 0) {
      Print("JUVO: set ApiUrl to the HTTPS server origin shown in JUVO. Local HTTP requires explicit opt-in."); return INIT_PARAMETERS_INCORRECT;
   }
   login = AccountInfoInteger(ACCOUNT_LOGIN); server_name = AccountInfoString(ACCOUNT_SERVER);
   if(login <= 0 || server_name == "") { Print("JUVO: sign in to the MT5 account first."); return INIT_FAILED; }
   string scope = Digest(origin + "\n" + server_name + "\n" + I(login));
   if(scope == "") return INIT_FAILED;
   storage = "JUVO\\" + scope;
   lock_handle = FileOpen(storage + ".lock", FILE_WRITE | FILE_BIN);
   if(lock_handle == INVALID_HANDLE) { Print("JUVO: another connector may already be attached to this account."); return INIT_FAILED; }
   LoadState();
   string incoming_hash = Digest(PairingCode);
   if(PairingCode != "" && incoming_hash != code_hash) {
      token = ""; account_key = ""; connection_id = ""; cursor = 0;
      code_hash = incoming_hash; attempt = Digest(scope + I((long)TimeLocal()) + U(GetMicrosecondCount()));
      if(!SaveState()) return INIT_FAILED;
   }
   if(token == "" && PairingCode == "") { Print("JUVO: generate a pairing code in JUVO and enter PairingCode."); return INIT_PARAMETERS_INCORRECT; }
   if(attempt == "") { attempt = Digest(scope + U(GetMicrosecondCount())); if(!SaveState()) return INIT_FAILED; }
   if(!EventSetTimer(1)) return INIT_FAILED;
   Print("JUVO: read-only connector started. Account-wide sync is enabled."); return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) {
   EventKillTimer();
   if(lock_handle != INVALID_HANDLE) FileClose(lock_handle);
}
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result) {
   // Event order is not guaranteed. Reconcile from terminal state on the timer.
   history_dirty = true; account_dirty = true; force_positions = true;
}
string PositionsJson() {
   int total = PositionsTotal();
   if(total > 500) { Print("JUVO: position limit exceeded; refusing a truncated snapshot."); return ""; }
   string rows = "[";
   for(int i = 0; i < total; i++) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket)) return "";
      if(i > 0) rows += ",";
      rows += "{\"id\":" + Q(I(PositionGetInteger(POSITION_IDENTIFIER))) + ",\"ticket\":" + Q(U(ticket)) +
         ",\"symbol\":" + Q(PositionGetString(POSITION_SYMBOL)) + ",\"type\":" + Q(EnumToString((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE))) +
         ",\"volume\":" + N(PositionGetDouble(POSITION_VOLUME)) + ",\"openPrice\":" + N(PositionGetDouble(POSITION_PRICE_OPEN)) +
         ",\"currentPrice\":" + N(PositionGetDouble(POSITION_PRICE_CURRENT)) + ",\"profit\":" + N(PositionGetDouble(POSITION_PROFIT)) +
         ",\"swap\":" + N(PositionGetDouble(POSITION_SWAP)) + ",\"magic\":" + Q(U((ulong)PositionGetInteger(POSITION_MAGIC))) +
         ",\"comment\":" + Q(PositionGetString(POSITION_COMMENT)) + ",\"time\":" + I(UtcMillis(PositionGetInteger(POSITION_TIME_MSC))) +
         ",\"updateTime\":" + I(UtcMillis(PositionGetInteger(POSITION_TIME_UPDATE_MSC))) +
         ",\"reason\":" + Q(EnumToString((ENUM_POSITION_REASON)PositionGetInteger(POSITION_REASON))) +
         ",\"stopLoss\":" + N(PositionGetDouble(POSITION_SL)) + ",\"takeProfit\":" + N(PositionGetDouble(POSITION_TP)) + "}";
   }
   if(PositionsTotal() != total) return "";
   return rows + "]";
}
string DealJson(ulong ticket) {
   return "{\"id\":" + Q(U(ticket)) + ",\"positionId\":" + Q(I(HistoryDealGetInteger(ticket, DEAL_POSITION_ID))) +
      ",\"orderId\":" + Q(I(HistoryDealGetInteger(ticket, DEAL_ORDER))) + ",\"symbol\":" + Q(HistoryDealGetString(ticket, DEAL_SYMBOL)) +
      ",\"type\":" + Q(EnumToString((ENUM_DEAL_TYPE)HistoryDealGetInteger(ticket, DEAL_TYPE))) +
      ",\"entryType\":" + Q(EnumToString((ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket, DEAL_ENTRY))) +
      ",\"reason\":" + Q(EnumToString((ENUM_DEAL_REASON)HistoryDealGetInteger(ticket, DEAL_REASON))) +
      ",\"time\":" + I(UtcMillis(HistoryDealGetInteger(ticket, DEAL_TIME_MSC))) +
      ",\"volume\":" + N(HistoryDealGetDouble(ticket, DEAL_VOLUME)) + ",\"price\":" + N(HistoryDealGetDouble(ticket, DEAL_PRICE)) +
      ",\"profit\":" + N(HistoryDealGetDouble(ticket, DEAL_PROFIT)) + ",\"commission\":" + N(HistoryDealGetDouble(ticket, DEAL_COMMISSION)) +
      ",\"swap\":" + N(HistoryDealGetDouble(ticket, DEAL_SWAP)) + ",\"fee\":" + N(HistoryDealGetDouble(ticket, DEAL_FEE)) +
      ",\"magic\":" + Q(U((ulong)HistoryDealGetInteger(ticket, DEAL_MAGIC))) + ",\"comment\":" + Q(HistoryDealGetString(ticket, DEAL_COMMENT)) +
      ",\"stopLoss\":" + N(HistoryDealGetDouble(ticket, DEAL_SL)) + ",\"takeProfit\":" + N(HistoryDealGetDouble(ticket, DEAL_TP)) + "}";
}
string OrderJson(ulong ticket) {
   return "{\"id\":" + Q(U(ticket)) + ",\"positionId\":" + Q(I(HistoryOrderGetInteger(ticket, ORDER_POSITION_ID))) +
      ",\"symbol\":" + Q(HistoryOrderGetString(ticket, ORDER_SYMBOL)) +
      ",\"type\":" + Q(EnumToString((ENUM_ORDER_TYPE)HistoryOrderGetInteger(ticket, ORDER_TYPE))) +
      ",\"state\":" + Q(EnumToString((ENUM_ORDER_STATE)HistoryOrderGetInteger(ticket, ORDER_STATE))) +
      ",\"reason\":" + Q(EnumToString((ENUM_ORDER_REASON)HistoryOrderGetInteger(ticket, ORDER_REASON))) +
      ",\"time\":" + I(UtcMillis(HistoryOrderGetInteger(ticket, ORDER_TIME_SETUP_MSC))) +
      ",\"doneTime\":" + I(UtcMillis(HistoryOrderGetInteger(ticket, ORDER_TIME_DONE_MSC))) +
      ",\"volume\":" + N(HistoryOrderGetDouble(ticket, ORDER_VOLUME_INITIAL)) + ",\"openPrice\":" + N(HistoryOrderGetDouble(ticket, ORDER_PRICE_OPEN)) +
      ",\"magic\":" + Q(U((ulong)HistoryOrderGetInteger(ticket, ORDER_MAGIC))) + ",\"comment\":" + Q(HistoryOrderGetString(ticket, ORDER_COMMENT)) +
      ",\"stopLoss\":" + N(HistoryOrderGetDouble(ticket, ORDER_SL)) + ",\"takeProfit\":" + N(HistoryOrderGetDouble(ticket, ORDER_TP)) + "}";
}
bool PrepareHistory() {
   if(history_pages == 0) {
      history_start = MathMax(0, cursor - 86400); history_end = (long)TimeTradeServer();
      if(history_end <= 0 || !HistorySelect((datetime)history_start, (datetime)history_end)) return false;
      history_deals = HistoryDealsTotal(); history_orders = HistoryOrdersTotal();
      history_pages = (int)MathMax(1, MathCeil((double)MathMax(history_deals, history_orders) / 100.0));
      if(history_pages > 20000) { Print("JUVO: history exceeds connector batch limit. Contact support."); stopped = true; return false; }
      history_page = 0; history_id = Digest(attempt + I(history_end) + U(GetMicrosecondCount())); history_dirty = false;
   }
   if(!HistorySelect((datetime)history_start, (datetime)history_end)) return false;
   // A late broker event can change pagination inside the fixed time window.
   if(HistoryDealsTotal() != history_deals || HistoryOrdersTotal() != history_orders) {
      history_pages = 0; history_dirty = true; return false;
   }
   string deals = "[", orders = "[";
   int start = history_page * 100;
   for(int i = start; i < MathMin(start + 100, HistoryDealsTotal()); i++) {
      ulong ticket = HistoryDealGetTicket(i); if(ticket == 0) return false;
      if(i > start) deals += ","; deals += DealJson(ticket);
   }
   for(int i = start; i < MathMin(start + 100, HistoryOrdersTotal()); i++) {
      ulong ticket = HistoryOrderGetTicket(i); if(ticket == 0) return false;
      if(i > start) orders += ","; orders += OrderJson(ticket);
   }
   pending_path = "/history";
   pending_body = Envelope() + ",\"syncId\":" + Q(history_id) + ",\"start\":" + I(history_start) + ",\"end\":" + I(history_end) +
      ",\"page\":" + I(history_page) + ",\"pageCount\":" + I(history_pages) + ",\"deals\":" + deals + "],\"orders\":" + orders + "]}";
   return true;
}
void SendPending() {
   char body[], response[]; string headers;
   int count = StringToCharArray(pending_body, body, 0, WHOLE_ARRAY, CP_UTF8); ArrayResize(body, count - 1);
   string request_headers = "Content-Type: application/json\r\nAccept: text/plain\r\n";
   if(token != "") request_headers += "Authorization: Connector " + token + "\r\n";
   ResetLastError();
   int status = WebRequest("POST", origin + "/api/broker/metatrader" + pending_path, request_headers, 10000, body, response, headers);
   if(status == 401 || status == 403 || status == 426 || (pending_path == "/pair" && status == 400)) {
      stopped = true;
      if(status == 401) { token = ""; FileDelete(storage + ".state"); }
      PrintFormat("JUVO: connection rejected (HTTP %d). Check the connector version or generate a new pairing code.", status); return;
   }
   string lines[];
   int length = StringSplit(CharArrayToString(response, 0, WHOLE_ARRAY, CP_UTF8), '\n', lines);
   if(status != 200 || length != 7 || lines[0] != "JUVO1") {
      failures = (int)MathMin(failures + 1, 6);
      retry_at = GetTickCount64() + (ulong)(MathMin(60, MathPow(2, failures)) * 1000);
      PrintFormat("JUVO: sync delayed (HTTP %d, terminal error %d). Retrying with bounded backoff.", status, GetLastError()); return;
   }
   failures = 0; retry_at = 0;
   if(pending_path == "/pair") {
      if(StringFind(lines[1], "jmt_") != 0 || StringLen(lines[1]) != 47 || StringLen(lines[3]) != 64) { stopped = true; Print("JUVO: invalid pairing response."); return; }
      token = lines[1]; connection_id = lines[2]; account_key = lines[3]; cursor = StringToInteger(lines[4]);
      if(!SaveState()) { stopped = true; return; }
      Print("JUVO: paired. Starting account and history reconciliation.");
   } else if(pending_path == "/history") {
      cursor = MathMax(cursor, StringToInteger(lines[4])); SaveState();
      history_page++;
      if(history_page >= history_pages) { history_pages = 0; history_at = GetTickCount64(); }
   } else if(pending_path == "/heartbeat") {
      long next = StringToInteger(lines[5]);
      if(next > requested || lines[6] == "1") { history_dirty = true; account_dirty = true; force_positions = true; }
      requested = next; heartbeat_at = GetTickCount64();
   } else if(pending_path == "/positions") { last_positions = pending_positions; positions_at = GetTickCount64(); }
   else if(pending_path == "/account") account_at = GetTickCount64();
   else if(pending_path == "/revoke") { FileDelete(storage + ".state"); stopped = true; Print("JUVO: disconnected and local credential cleared."); ExpertRemove(); }
   pending_path = ""; pending_body = "";
}
void OnTimer() {
   if(stopped || GetTickCount64() < retry_at) return;
   if(login != AccountInfoInteger(ACCOUNT_LOGIN) || server_name != AccountInfoString(ACCOUNT_SERVER)) {
      stopped = true; Print("JUVO: account changed. Reattach and pair this account separately."); return;
   }
   bool connected = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   if(connected) offset_seconds = BrokerUtcOffsetMinutes == 9999 ? (int)(MathRound((double)(TimeTradeServer() - TimeGMT()) / 60) * 60) : BrokerUtcOffsetMinutes * 60;
   ulong now = GetTickCount64();
   if(pending_path != "") {
      // A retried live snapshot must not masquerade as a fresh market quote.
      if(pending_path == "/positions") {
         if(!connected) { pending_path = ""; force_positions = true; return; }
         pending_positions = PositionsJson(); if(pending_positions == "") return;
         pending_body = Envelope() + ",\"sequence\":" + I((long)TimeGMT() * 1000 + (long)(now % 1000)) + ",\"positions\":" + pending_positions + "}";
      } else if(pending_path == "/account") {
         if(!connected) { pending_path = ""; account_dirty = true; return; }
         pending_body = Envelope() + ",\"account\":" + AccountJson() + "}";
      } else if(pending_path == "/heartbeat") pending_body = Envelope() + ",\"terminalConnected\":" + (connected ? "true" : "false") + "}";
      SendPending(); return;
   }
   if(token == "") {
      if(!connected) return;
      pending_path = "/pair"; pending_body = "{\"protocolVersion\":1,\"connectorVersion\":\"1.0.0\",\"code\":" + Q(PairingCode) + ",\"attemptId\":" + Q(attempt) + ",\"account\":" + AccountJson() + "}";
   } else if(DisconnectAndClear) { pending_path = "/revoke"; pending_body = Envelope() + "}"; }
   else if(now - heartbeat_at >= 5000) {
      pending_path = "/heartbeat"; pending_body = Envelope() + ",\"terminalConnected\":" + (connected ? "true" : "false") + "}";
   } else if(!connected) return;
   else if(account_dirty || now - account_at >= 30000) {
      account_dirty = false; pending_path = "/account"; pending_body = Envelope() + ",\"account\":" + AccountJson() + "}";
   } else {
      history_turn = !history_turn;
      if(history_turn && (history_dirty || history_pages > 0 || now - history_at >= 60000)) {
         if(!PrepareHistory()) return;
      } else if(force_positions || now - positions_at >= (ulong)MathMax(1, PositionIntervalSeconds) * 1000) {
         string positions = PositionsJson(); if(positions == "") return;
         if(positions == last_positions && !force_positions) { positions_at = now; return; }
         force_positions = false; pending_positions = positions; pending_path = "/positions";
         pending_body = Envelope() + ",\"sequence\":" + I((long)TimeGMT() * 1000 + (long)(now % 1000)) + ",\"positions\":" + positions + "}";
      } else return;
   }
   SendPending();
}
