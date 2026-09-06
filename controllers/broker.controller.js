export async function connectCTrader(req, res, next) {
  try {
    const params = new URLSearchParams({
      client_id: process.env.CTRADER_CLIENT_ID,
      redirect_uri: process.env.CTRADER_REDIRECT_URI,
      scope: "accounts",
      product: "web",
    });

    const authorizationUrl = `https://id.ctrader.com/my/settings/openapi/grantingaccess/?${params.toString()}`;

    return res.status(200).json({
      authorizationUrl,
    });
  } catch (error) {
    next(error);
  }
}
