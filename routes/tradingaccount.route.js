import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { createTradingAccountController, deleteTradingAccountController, getUserTradingAccountsController } from "../controllers/TradingAccount.js";

const tradingAccountRoutes = Router();

tradingAccountRoutes.post("/create-trading-account", requireAuth, createTradingAccountController);
tradingAccountRoutes.get("/get-user-trading-accounts", requireAuth, getUserTradingAccountsController);
tradingAccountRoutes.delete("/delete-trading-account/:accountId", requireAuth, deleteTradingAccountController);


export default tradingAccountRoutes;