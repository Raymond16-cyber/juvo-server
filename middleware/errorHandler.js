function notFound(req, res) {
  res.status(404).json({ message: "Route not found." });
}

function errorHandler(error, req, res, next) {
  const status = error.status || 500;

  res.status(status).json({
    message: error.message || "Internal server error.",
  });
}

export { notFound, errorHandler };