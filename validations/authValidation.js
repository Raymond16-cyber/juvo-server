function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateRegisterInput(payload) {
  const errors = [];
  const fullName = (payload.fullName || "").trim();
  const email = (payload.email || "").trim().toLowerCase();
  const password = payload.password || "";
  const pushToken = (payload.pushToken || "").trim();

  if (!fullName) errors.push("Full name is required.");
  if (!email) errors.push("Email is required.");
  if (email && !validateEmail(email)) errors.push("Email is invalid.");
  if (!password) errors.push("Password is required.");
  if (password && password.length < 6)
    errors.push("Password must be at least 6 characters.");

  return {
    isValid: errors.length === 0,
    errors,
    data: { fullName, email, password, pushToken },
  };
}

function validateLoginInput(payload) {
  const errors = [];
  const email = (payload.email || "").trim().toLowerCase();
  const password = payload.password || "";

  if (!email) errors.push("Email is required.");
  if (email && !validateEmail(email)) errors.push("Email is invalid.");
  if (!password) errors.push("Password is required.");

  return {
    isValid: errors.length === 0,
    errors,
    data: { email, password },
  };
}

function validateAppleAuthInput(payload) {
  const errors = [];
  const appleUserId = (payload.appleUserId || "").trim();
  const email = (payload.email || "").trim().toLowerCase();
  const fullName = (payload.fullName || "").trim();
  const pushToken = (payload.pushToken || "").trim();

  if (!appleUserId) errors.push("Apple user ID is required.");

  return {
    isValid: errors.length === 0,
    errors,
    data: { appleUserId, email, fullName, pushToken },
  };
}

function validateRequestOtpInput(payload) {
  const errors = [];

  const email = (payload.email || "").trim().toLowerCase();

  if (!email) {
    errors.push("Email is required.");
  }

  if (email && !validateEmail(email)) {
    errors.push("Email is invalid.");
  }
  return {
    isValid: errors.length === 0,
    errors,
    data: {
      email,
    },
  };
}

function validateResetPasswordInput(payload) {
  const errors = [];

  const email = (payload.email || "").trim().toLowerCase();
  const passwords = payload.passwords || "";

  if (!email) {
    errors.push("Email is required.");
  }

  if (email && !validateEmail(email)) {
    errors.push("Email is invalid.");
  }

  if (!passwords) {
    errors.push("New password is required.");
  }

  if (passwords && passwords.length < 6) {
    errors.push("Password must be at least 6 characters.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      email,
      passwords,
    },
  };
}

function validateVerifyOtpVerificationCodeInput(payload) {
  const errors = [];
  const otpVerificationCode = String(payload.otp || "").trim();

  if (!otpVerificationCode) {
    errors.push("OTP verification code is required.");
  } else if (!/^\d{6}$/.test(otpVerificationCode)) {
    errors.push("OTP verification code must be exactly 6 digits.");
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: { otpVerificationCode },
  };
}

export {
  validateRegisterInput,
  validateLoginInput,
  validateAppleAuthInput,
  validateRequestOtpInput,
  validateVerifyOtpVerificationCodeInput,
};
