function notFound(req, res) {
  res.status(404).json({ message: "Route not found." });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = Number(error.status || error.statusCode || 500);
  let message = error.message || "Internal server error.";
  if (error.name === "CastError") {
    status = 400;
    message = "Invalid request value.";
  } else if (error.name === "ValidationError") {
    status = 400;
    message = "One or more fields are invalid.";
  } else if (error.code === 11000) {
    status = 409;
    message = "This record already exists.";
  } else if (error.type === "entity.parse.failed") {
    status = 400;
    message = "Request body must be valid JSON.";
  }
  if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
  if (status >= 500) message = "Unable to complete the request. Please try again.";

  res.status(status).json({
    message,
  });
}

export { notFound, errorHandler };
