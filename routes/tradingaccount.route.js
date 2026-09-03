import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  activateTradingAccountController,
  createTradingAccountController,
  deleteTradingAccountController,
  getTradingAccountByIdController,
  getUserTradingAccountsController,
} from "../controllers/TradingAccount.js";

const tradingAccountRoutes = Router();

tradingAccountRoutes.post("/create-trading-account", requireAuth, createTradingAccountController);
tradingAccountRoutes.get("/get-user-trading-accounts", requireAuth, getUserTradingAccountsController);
tradingAccountRoutes.get("/:accountId", requireAuth, getTradingAccountByIdController);
tradingAccountRoutes.patch("/:accountId/activate", requireAuth, activateTradingAccountController);
tradingAccountRoutes.delete("/delete-trading-account/:accountId", requireAuth, deleteTradingAccountController);

export default tradingAccountRoutes;