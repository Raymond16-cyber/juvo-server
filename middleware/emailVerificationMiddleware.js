function isEmailVerified(user) {
  if (!user) return false;
  if (typeof user.emailVerified === "boolean") return user.emailVerified;
  return Boolean(user.security?.emailVerified);
}

function requireVerifiedEmail(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "User is not signed in." });
    }

    if (!isEmailVerified(req.user)) {
      return res.status(403).json({
        success: false,
        code: "EMAIL_NOT_VERIFIED",
        message:
          "Verify your email to use this feature. You can resend the link from Settings or the verification page.",
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

export { isEmailVerified, requireVerifiedEmail };
