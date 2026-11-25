export function parseAllowedOrigins(configuredOrigins) {
  return (configuredOrigins || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      if (origin === "*") {
        throw new Error(
          "Wildcard CORS origins are not allowed when credentials are enabled.",
        );
      }

      let parsedOrigin;
      try {
        parsedOrigin = new URL(origin);
      } catch {
        throw new Error("CORS origins must be valid absolute URLs.");
      }

      if (!["http:", "https:"].includes(parsedOrigin.protocol)) {
        throw new Error("CORS origins must use HTTP or HTTPS.");
      }

      return parsedOrigin.origin;
    });
}
