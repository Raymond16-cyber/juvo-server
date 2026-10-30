/**
 * Private beta tester APIs are handled through the main auth flow:
 * - GET  /api/auth/beta-status
 * - POST /api/auth/sign-up  (testerCode when BETA_ACCESS_MODE=true)
 * - POST /api/auth/sign-in  (testerCode when required)
 * - requireAuth middleware enforces the 24h window
 *
 * Code generation uses the CLI: npm run beta:codes:create
 * See server/docs/beta-access.md
 */

export {};
