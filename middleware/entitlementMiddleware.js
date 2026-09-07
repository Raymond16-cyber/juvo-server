import {
  ENTITLEMENTS,
  JUVO_AI_ACCESS_REQUIRED,
  getUserFeatureAccess,
} from "../services/entitlement.service.js";

function getUserId(user) {
  return user?.id || user?._id;
}

function buildAccessDeniedPayload(entitlement, access) {
  if (entitlement === ENTITLEMENTS.JUVO_AI) {
    return { ...JUVO_AI_ACCESS_REQUIRED, access };
  }

  return {
    success: false,
    code: "ENTITLEMENT_REQUIRED",
    message: "Your plan does not include this feature.",
    access,
  };
}

function requireEntitlement(entitlement) {
  return async (req, res, next) => {
    try {
      const userId = getUserId(req.user);
      if (!userId) {
        return res.status(401).json({ message: "User is not signed in." });
      }

      const access = await getUserFeatureAccess(userId, entitlement);
      if (!access?.hasAccess) {
        return res.status(403).json(buildAccessDeniedPayload(entitlement, access));
      }

      req.featureAccess = access;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export { requireEntitlement };
