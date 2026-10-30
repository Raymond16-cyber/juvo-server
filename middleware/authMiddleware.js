import { verifyToken } from "../utils/token.js";
import { findUserById } from "../repositories/userRepository.js";
import {
  assertBetaAccessForRequest,
  isBetaAccessModeEnabled,
  presentBetaAccess,
} from "../services/betaAccess.service.js";

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      return res.status(401).json({ message: "Unauthorized." });
    }
    const user = await findUserById(decoded.sub);

    if (!user) {
      return res.status(401).json({ message: "Unauthorized." });
    }

    const access = await assertBetaAccessForRequest(user);
    if (!access.allowed) {
      return res.status(403).json({
        success: false,
        code: access.code,
        message: access.message,
        betaAccess: access.beta,
      });
    }

    req.user = access.user;
    req.betaAccess = access.beta;
    return next();
  } catch (error) {
    return next(error);
  }
}

function getBetaModePublicStatus() {
  return {
    enabled: isBetaAccessModeEnabled(),
    message: isBetaAccessModeEnabled()
      ? "JUVO is currently available to invited testers."
      : "Public authentication is enabled.",
  };
}

export { getBetaModePublicStatus, presentBetaAccess, requireAuth };
