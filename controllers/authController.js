import { registerService,loginService,appleAuthService } from "../services/authService.js";

async function register(req, res, next) {
  try {
    const result = await registerService(req.body);

    return res.status(201).json({
      message: "User registered successfully.",
      user: result.user,
      token: result.token,
    });
  } catch (error) {
    return next(error);
  }
}

async function login(req, res, next) {
  try {
    const result = await loginService(req.body);

    return res.status(200).json({
      message: "Login successful.",
      user: result.user,
      token: result.token,
    });
  } catch (error) {
    return next(error);
  }
}

async function appleAuth(req, res, next) {
  console.log("Apple Auth Request Body:", req.body); // Log the request body for debugging
  try {
    const result = await appleAuthService(req.body);

    return res.status(result.created ? 201 : 200).json({
      message: result.created
        ? "Apple account created successfully."
        : "Apple login successful.",
      user: result.user,
      token: result.token,
      created: result.created,
    });
  } catch (error) {
    return next(error);
  }
}

async function me(req, res) {
  return res.status(200).json({
    user: req.user,
  });
}

export {
  register,
  login,
  appleAuth,
  me,
};