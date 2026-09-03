# juvo-server

## Trading accounts

I tied trades to trading accounts, but the daily journal stays one session for the day.

- Each account has a `trades` list, `isActive`, and `status` (`Active`, `Passed`, `Breached`).
- There is one journal per day. It records every trade that day, no matter which account it was taken on.
- A trade also goes on the trading account if that account is the active, in-play one.
- If an account passes or is breached, I do not start a new journal. I create a new account, then keep logging trades on today’s journal.
- After a close I update that account’s balance and mark it Passed or Breached from `profitTarget` / `maxDrawnDown`.
