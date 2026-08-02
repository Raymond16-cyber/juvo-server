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

function validateResetPasswordInput(payload) {
  const errors = [];
  let oldPassword = "";
  let newPassword = "";
  const email = (payload.email || "").trim().toLowerCase();
  
  if (!email) errors.push("Email is required.");
  if (email && !validateEmail(email)) errors.push("Email is invalid.");
  
  if (payload.passwords) {
    oldPassword = (payload.passwords.old || "").trim();
    newPassword = (payload.passwords.new || "").trim();

    if (!oldPassword || !newPassword)
      errors.push("Old and New password is required");
  }
  return {
    isValid: errors.length === 0,
    errors,
    data: payload.passwords ? { email, oldPassword, newPassword } : { email },
  };
}

function validateVerifyResetPasswordCodeInput(payload) {
  const errors = [];
  const resetPasswordCode = (payload.resetPasswordCode || "").trim();
  if (!resetPasswordCode) errors.push("Reset password code is required.");

  return {
    isValid: errors.length === 0,
    errors,
    data: { resetPasswordCode },
  };
}

export {
  validateRegisterInput,
  validateLoginInput,
  validateAppleAuthInput,
  validateResetPasswordInput,
  validateVerifyResetPasswordCodeInput,
};
