# JUVO Connector for MT5

This EA reads the signed-in terminal account. It has no order execution or position modification functions. It observes manual trades, mobile-origin trades visible to the terminal, other EAs, and broker-side activity across the entire account, not just the attached chart.

## Backend setup

Keep existing JUVO MongoDB, JWT, cTrader and frontend configuration. Add these connector settings to the backend environment:

```dotenv
# Production: externally reachable HTTPS origin, no /api suffix or trailing path.
MT5_CONNECTOR_URL=https://your-juvo-api.example
# Only enable detailed connector event names locally; credentials are never logged.
MT5_DEBUG=false
# Only behind exactly one trusted reverse proxy, with direct access blocked:
# TRUST_PROXY_HOPS=1
```

`JWT_SECRET` is already required by JUVO authentication and is also used with a separate HMAC namespace to derive opaque pairing credentials. No new external provider secret is required. Development defaults to `http://localhost:5000`; production pairing is disabled without an explicit HTTPS origin. Do not expose the backend directly if using trusted-proxy headers. Use an exact proxy-hop count appropriate to the deployment, never a permissive trust setting.

Run one backend process for this release. The live-position cache, upload exclusion and realtime hub are process-local. Multiple workers need shared coordination, cache/fanout and rate-limit storage before deployment. The durable history ledger and checkpoints are in MongoDB.

## Installation and compilation

1. Start JUVO and sign in. Open Accounts / Brokers, then the MetaTrader 5 section.
2. Download `JUVOConnector.mq5`. In MT5 choose File / Open Data Folder. Put the file in `MQL5/Experts/JUVOConnector.mq5`.
3. Open MetaEditor with F4. Open this source and press F7. Check the compiler result for zero errors. `JUVOConnector.ex5` is generated beside the source. Refresh Expert Advisors in MT5 Navigator if necessary.
4. In MT5 select Tools / Options / Expert Advisors. Enable **Allow WebRequest for listed URL** and add the exact server origin shown by JUVO. Do not add `/api/broker/metatrader` to ApiUrl.
5. In JUVO generate a pairing code. It expires after ten minutes. Keep it private: someone with this code could link an account to your JUVO profile.
6. Open a separate chart and attach JUVO Connector from Navigator. Do not replace another EA on its existing chart. Set `ApiUrl` and `PairingCode` to the values from JUVO. For local development HTTP only, set `AllowLocalHttp=true`; production must use HTTPS. No DLL import or trading permission is required by the connector.
7. Leave MT5 open, connected to the broker, and the EA attached. JUVO should show a heartbeat, then synchronized account data, history and open positions. MT5 web/mobile applications cannot run the EA.
8. After pairing, the original code can be cleared from the EA inputs. Its stored credential is used on restart. Do not put codes or tokens in shared `.set` presets, screenshots or source control.

Use **one connector per account**. The EA locks its account-scoped state file to prevent duplicate copies in the same terminal. Another installation paired with a new code rotates the previous credential. Existing cTrader connections are independent.

## Data flow and timing

- Timer ticks every second; work is serialized, with at most one synchronous WebRequest per timer invocation. Timeout is ten seconds. Failure retry delays rise from two to sixty seconds. The queue holds one pending request and dirty flags, not a growing list of ticks.
- `OnTradeTransaction` only marks account, positions and history dirty. Timer reconciliation reads native terminal state, so event ordering and the transaction queue cannot create duplicate trade rows.
- Heartbeats target five seconds. JUVO marks a heartbeat stale after fifteen seconds and offline after forty-five seconds, or immediately when MT5 reports it is disconnected. The server sweep runs every five seconds. Heavy initial history requests or a slow network can delay heartbeats.
- Account balance, equity, margin, free margin, leverage and actual broker currency are uploaded initially, on transaction changes, on reconciliation, and every thirty seconds. These are native account snapshots, not balances rebuilt by adding imported trades.
- Positions target two-second snapshots by default, subject to other queued work. Identity uses `POSITION_IDENTIFIER`, not a ticket that may change under netting. Current price and native `POSITION_PROFIT` update the in-memory cache and existing browser realtime channel. Durable writes happen when position structure, volume, SL/TP or swap changes, not on every price movement.
- Native floating **gross** profit is not labeled as final net settlement. Position swap is separate. Final realized P/L includes the broker's deal profit, attached commission, swap and fee; entry costs are allocated across realized partial closes.
- History starts at zero for a new connection, then replays from the server-acknowledged checkpoint minus one day. Batches contain up to 100 deals and 100 orders per page, maximum 20,000 pages. An empty history still sends a complete batch. If terminal counts change during a batch, a new batch starts from the unchanged checkpoint.
- The checkpoint advances only after every page is stored and normalization completes without missing entry history. The ledger deduplicates broker tickets. Canonical trade IDs are account plus closing-deal ID. Repeated history uploads update the same trades and preserve notes, planned RR and reflections.
- Realized portions of partial closes become separate canonical realized trade records. A netting reversal closes prior exposure and starts the remaining opposite exposure. Weighted entry prices are used for scale-ins. Deposits/withdrawals are not journal trades.
- Calendar/journal dates use the user's journal timezone after timestamp normalization. Existing analytics, exports, behavioral review and AI consume the canonical Trade model, not a new isolated MT5 trade collection. Missing risk and RR stay unknown instead of being fabricated.

## Timezone limitation

MT5 history selection uses broker server time. The EA keeps its checkpoint in server seconds and converts record timestamps to UTC using the current detected broker offset. `BrokerUtcOffsetMinutes=9999` means automatic current-offset detection; set a numeric minute offset only when you know the broker's policy. Keep the Windows clock/timezone correct.

**Historical daylight-saving changes cannot be inferred reliably from the current offset.** A broker with changing server offsets needs a historical offset schedule before old trade timestamps across those changes can be guaranteed exact. An explicit fixed offset does not solve a history spanning multiple offsets. Validate imports near midnight and DST boundaries against the terminal before relying on daily attribution. This release does not claim to reconstruct that missing broker timezone metadata.

## Disconnect, restart and storage

The browser Disconnect button revokes the credential and stops future uploads. Existing journals/trades remain. Open snapshots become unknown, not falsely realized trades. Generate a new pairing code and reattach/update the EA inputs to reconnect. A busy upload may return a retry message; retry disconnect after that upload finishes.

Alternatively, set EA input `DisconnectAndClear=true` to request revocation and clear its local credential after acknowledgement. Set it back to false before pairing again. If the server is unreachable the request retries; use the browser disconnect once reachable. Removing the EA alone stops updates but does not revoke its token.

The local credential and checkpoint are stored inside the terminal's sandbox at `MQL5/Files/JUVO/<account-and-origin-hash>.state`. This file contains a usable credential, not an encrypted secret vault. Protect the Windows user profile and backups; do not share it. The lock file is adjacent. MongoDB stores only the token hash. HTTP responses containing pairing credentials have `Cache-Control: no-store`. Browser APIs never return the connector token.

Pairing is one-time per account/attempt. An identical attempt may recover a lost successful response until the code expires; a different account or attempt cannot reuse it. A revoked or superseded pairing cannot recover the old credential. The token has no browser-session or trading authority. Rotating JWT_SECRET prevents reconstructing old pairing responses but does not itself revoke already issued opaque tokens; revoke those connections explicitly during incident response.

## Demo-account acceptance test

1. Pair an MT5 demo account using the steps above. Check native currency, balance/equity, existing history and all open positions against MT5.
2. Open a demo position manually in MT5. Confirm it appears in JUVO; observe current price and gross floating P/L. JUVO itself must have no execution control.
3. Change SL/TP in MT5 and confirm the snapshot updates. Partially close, then fully close in MT5; confirm realized portions, costs and journal notices without duplicates.
4. Open another demo position using a separate EA on another chart. Confirm JUVO detects it account-wide. Test both hedging and netting demo accounts, including a reversal.
5. Select Sync broker repeatedly. Trade count and saved notes must not duplicate or reset.
6. Close MT5. Wait at least fifty seconds and confirm offline status and no fresh P/L. Trade using another device while desktop is offline. Restart MT5; verify missed closes and current positions reconcile.
7. Interrupt network access during historical upload, then restore it. Check replay does not duplicate trades and history eventually catches up.
8. Disconnect in JUVO. Confirm subsequent EA uploads are refused and history remains. Re-pair with a new code; check that the account is reused and the old token no longer works.
9. Check expired codes, wrong server/account bindings, another JUVO user's ownership, and duplicate EA attachments. Never share actual codes/tokens when reporting results.
10. Independently smoke-test cTrader OAuth, sync, open positions and a demo close. Automated shared-model regression tests are not a substitute for a live broker check.

## Known limitations

- MT5 only. No MT4 connector, hosted terminal, execution or Strategy Tester networking.
- Terminal history must contain entry deals needed to reconstruct closes. Missing entry history remains flagged; no guessed price or profit is inserted. Corrected/deleted historical broker records outside the overlap require an operator-led full replay; this release does not automatically reverse already imported trades that the broker later deletes.
- Standalone balance charges, tax/commission adjustments not attached to trade deals are retained in the ledger but not allocated arbitrarily to journal trades. Account balance still comes directly from MT5.
- Account identity is server/login/platform. The existing TradingAccount uniqueness rule additionally includes broker and lacks server; a same-login/same-broker conflict on another server is rejected safely rather than overwriting an account. A future index/data migration is needed to allow that combination.
- No end-to-end broker demo test has been performed automatically. Do not attach the connector to a real-money terminal as a substitute for demo acceptance testing.

## Official API references

- [OnTradeTransaction](https://www.mql5.com/en/docs/event_handlers/ontradetransaction)
- [WebRequest](https://www.mql5.com/en/docs/network/webrequest)
- [HistorySelect](https://www.mql5.com/en/docs/trading/historyselect)
- [Position properties](https://www.mql5.com/en/docs/constants/tradingconstants/positionproperties)
- [Deal properties](https://www.mql5.com/en/docs/constants/tradingconstants/dealproperties)
- [Order properties](https://www.mql5.com/en/docs/constants/tradingconstants/orderproperties)
- [FileOpen sandbox and flags](https://www.mql5.com/en/docs/files/fileopen)
- [MetaEditor compilation](https://www.metatrader5.com/en/metaeditor/help/development/compile)
