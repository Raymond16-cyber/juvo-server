# juvo-server

## Paystack billing

JUVO uses Paystack hosted checkout for Pro and Super. The browser only receives Paystack's hosted authorization URL; it never receives a Paystack secret key, access token, refresh token, or card data.

1. Create the Pro and Super monthly plans in Paystack and copy their plan codes into `PAYSTACK_PRO_MONTHLY_PLAN_CODE` and `PAYSTACK_SUPER_MONTHLY_PLAN_CODE`.
2. Set `PAYSTACK_SECRET_KEY`, `PAYSTACK_BILLING_CURRENCY`, and `PAYSTACK_CALLBACK_URL` from `.env.example`. The configured Paystack plan amount, interval, and currency are checked on the server before checkout.
3. In the Paystack dashboard, set the webhook URL to `https://your-api-host/api/billing/webhook`. It validates Paystack's `x-paystack-signature` against the exact raw request body before queuing the event.
4. Test checkout with a Paystack test key and test card first. A redirect alone does not grant access: JUVO verifies the transaction on the server and records the payment idempotently. The webhook reconciles delayed confirmation and renewals.

Supported lifecycle events are `charge.success`, `subscription.create`, `subscription.not_renew`, `subscription.disable`, `invoice.create`, `invoice.update`, and `invoice.payment_failed`. Cancelling renewal keeps paid access through the recorded period end. Failed renewal payments are marked past due; JUVO does not invent a grace period.

The independent three-day JUVO AI trial is unchanged. Paid entitlements are enforced on the server and expire with the paid subscription.

## MT5 Connector

JUVO now supports a first-party, read-only MT5 EA connector. See [installation and demo testing](connectors/mt5/README.md) and the [migration/delivery report](docs/mt5-connector-migration.md). cTrader continues to use its independent Open API integration.

## Verification

Run `npm test`. Workflow tests mock persistence and external services; they do not connect to MongoDB or cTrader. Test a live manual trade close and broker reconnection separately in a development account.

## Journal exports and validation

- Authenticated `GET /api/journal/export` returns versioned journal data with reporting currency, timezone, and export timestamp. It uses selected journal and trade fields, excluding raw broker payloads and credentials.
- Manual trades are created open, then finalized through the close endpoint. Values must be finite, protective levels must match direction, and the close date cannot precede the open date. Imported cTrader trades remain controlled by broker sync.
- Closing claims an open trade atomically before applying the balance change; balance changes use atomic increments. The trade and account updates are still separate database writes, so full crash recovery requires transaction or reconciliation work.
- Realized analytics exclude open and cancelled P/L. Achieved RR of zero is preserved, and invalid account filters return 404.

## Trading accounts

I tied trades to trading accounts, but the daily journal stays one session for the day.

- Each account has a `trades` list, `isActive`, and `status` (`Active`, `Passed`, `Breached`).
- There is one journal per day. It records every trade that day, no matter which account it was taken on.
- A trade also goes on the trading account if that account is the active, in-play one.
- If an account passes or is breached, I do not start a new journal. I create a new account, then keep logging trades on today’s journal.
- After a close I update that account’s balance and mark it Passed or Breached from `profitTarget` / `maxDrawnDown`.
