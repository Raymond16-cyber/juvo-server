import { Resend } from "resend";
import { performance } from "node:perf_hooks";

const resend = new Resend(process.env.RESEND_API_KEY);

const EMAIL_FROM = process.env.EMAIL_FROM;

async function sendMailWithLogging({ to, subject, html }) {
  const startedAt = performance.now();

  try {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured.");
    }

    if (!EMAIL_FROM) {
      throw new Error("EMAIL_FROM is not configured.");
    }

    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html,
    });

    // Resend may return an error object instead of throwing an exception.
    if (error) {
      const deliveryError = new Error(error.message);
      deliveryError.code = error.name || "RESEND_DELIVERY_FAILED";
      throw deliveryError;
    }

    console.log("[Email] Sent successfully", {
      to,
      subject,
      emailId: data?.id,
      elapsedMs: Math.round(performance.now() - startedAt),
    });

    return data;
  } catch (error) {
    console.error("[Email] Delivery failed", {
      to,
      subject,
      elapsedMs: Math.round(performance.now() - startedAt),
      code: error.code,
      message: error.message,
    });

    throw error;
  }
}

export async function sendOtpToEmail(email, otp, type) {
  let subject;
  let html;

  switch (type) {
    case "request-reset-password":
      subject = "JUVO Password Reset Code";

      html = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto;">
          <h2>Password Reset</h2>
          <p>We received a request to reset your JUVO password.</p>
          <p>Your verification code is:</p>

          <div style="
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 8px;
            padding: 20px;
            background: #f4f4f4;
            text-align: center;
            margin: 20px 0;
          ">
            ${otp}
          </div>

          <p>
            This code will expire shortly. If you did not request a password
            reset, you can safely ignore this email.
          </p>

          <p>— The JUVO Team</p>
        </div>
      `;
      break;

    default:
      throw new Error(`Unsupported email type: ${type}`);
  }

  await sendMailWithLogging({
    to: email,
    subject,
    html,
  });

  return otp;
}


function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

export async function sendWaitlistInvitationEmail(
  email,
  name,
  code,
  expiresAt,
) {
  const safeName = escapeHtml(name || "there");
  const safeCode = escapeHtml(code);
  const expiryDate = new Date(expiresAt);

  const formattedExpiry = Number.isNaN(expiryDate.getTime())
    ? "the stated expiration date"
    : expiryDate.toUTCString();

  const html = `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="color-scheme" content="light">
      <meta name="supported-color-schemes" content="light">
      <title>Your JUVO Invitation</title>
    </head>

    <body style="margin:0;padding:0;background-color:#eef1f5;font-family:Arial,Helvetica,sans-serif;color:#111827;">

      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
        border="0" style="background-color:#eef1f5;">
        <tr>
          <td align="center" style="padding:32px 12px;">

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
              border="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;">

              <!-- Brand header -->
              <tr>
                <td style="background-color:#0b1020;padding:28px 30px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td valign="middle">
                        <span style="font-size:27px;font-weight:800;letter-spacing:-1px;color:#ffffff;">
                          JUVO
                        </span>
                        <br>
                        <span style="font-size:10px;letter-spacing:2px;color:#c5f277;">
                          TRADE WITH INTENTION
                        </span>
                      </td>
                      <td align="right" valign="middle">
                        <span style="display:inline-block;padding:8px 10px;border:1px solid #354158;border-radius:20px;color:#c5f277;font-size:10px;font-weight:bold;letter-spacing:1px;">
                          EARLY ACCESS
                        </span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Main message -->
              <tr>
                <td style="padding:34px 30px 12px;">
                  <p style="margin:0 0 14px;color:#648b2c;font-size:11px;font-weight:bold;letter-spacing:2px;">
                    YOUR INVITATION HAS ARRIVED
                  </p>

                  <h1 style="margin:0 0 18px;font-size:30px;line-height:1.2;letter-spacing:-1px;color:#111827;">
                    You're closer to trading with discipline.
                  </h1>

                  <p style="margin:0 0 14px;font-size:15px;line-height:1.8;color:#4b5563;">
                    Hey ${safeName},
                  </p>

                  <p style="margin:0;font-size:15px;line-height:1.8;color:#4b5563;">
                    Welcome to JUVO. Your early-access invitation is here.
                    Start building a clearer picture of your trading decisions,
                    track your performance, and work toward greater consistency.
                  </p>
                </td>
              </tr>

              <!-- Discount panel -->
              <tr>
                <td style="padding:24px 30px 10px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                    border="0" style="background-color:#f5f8ef;border:1px solid #e2ebd4;border-radius:12px;">
                    <tr>
                      <td align="center" style="padding:22px 16px;">
                        <p style="margin:0 0 8px;color:#526b35;font-size:11px;font-weight:bold;letter-spacing:2px;">
                          YOUR EARLY-ACCESS PERK
                        </p>

                        <p style="margin:0;font-size:38px;line-height:1.2;font-weight:800;letter-spacing:-1px;color:#1c2b12;">
                          40% OFF
                        </p>

                        <p style="margin:8px 0 0;font-size:13px;line-height:1.6;color:#526b35;">
                          Your first successful qualifying subscription payment
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Invitation code -->
              <tr>
                <td style="padding:22px 30px 10px;">
                  <p style="margin:0 0 12px;font-size:12px;font-weight:bold;letter-spacing:1px;color:#374151;">
                    YOUR INVITATION CODE
                  </p>

                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                    border="0" style="background-color:#0b1020;border-radius:12px;">
                    <tr>
                      <td align="center" style="padding:25px 12px;">
                        <p style="margin:0;font-size:25px;line-height:1.4;font-weight:bold;letter-spacing:4px;color:#c5f277;overflow-wrap:anywhere;">
                          ${safeCode}
                        </p>
                        <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#b9c4d5;">
                          Keep this code safe. You'll need it to redeem your offer.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Redemption instructions -->
              <tr>
                <td style="padding:18px 30px 10px;">
                  <h2 style="margin:0 0 10px;font-size:17px;color:#111827;">
                    How to redeem your invitation
                  </h2>

                  <p style="margin:0;font-size:14px;line-height:1.8;color:#4b5563;">
                    1. Create your JUVO account.<br>
                    2. Verify your email address.<br>
                    3. Apply your invitation code during the redemption process.
                  </p>

                  <p style="margin:14px 0 0;font-size:13px;line-height:1.7;color:#6b7280;">
                    Your code expires on
                    <strong style="color:#374151;">${escapeHtml(formattedExpiry)}</strong>.
                    The 40% discount applies only to your first successful qualifying
                    subscription payment. Subsequent payments use the regular plan price.
                  </p>
                </td>
              </tr>

              <!-- CTA -->
              <tr>
                <td align="center" style="padding:26px 30px 34px;">
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td align="center" bgcolor="#c5f277" style="border-radius:8px;">
                        <a href="https://juvo-os.app"
                          style="display:inline-block;padding:16px 28px;font-size:14px;font-weight:bold;color:#17220d;text-decoration:none;border-radius:8px;">
                          Open JUVO &rarr;
                        </a>
                      </td>
                    </tr>
                  </table>

                  <p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:#6b7280;">
                    Your trading journey deserves more than guesswork.
                    Make every trade a learning opportunity.
                  </p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color:#f8fafc;border-top:1px solid #e5e7eb;padding:22px 30px;">
                  <p style="margin:0 0 7px;font-size:14px;font-weight:bold;color:#111827;">
                    The JUVO Team
                  </p>

                  <p style="margin:0;font-size:12px;line-height:1.7;color:#6b7280;">
                    Build discipline. Understand your trades. Improve with intention.
                  </p>

                  <p style="margin:14px 0 0;font-size:11px;line-height:1.6;color:#9ca3af;">
                    This email contains a private early-access invitation intended
                    for the recipient above.
                  </p>
                </td>
              </tr>

            </table>

            <p style="margin:18px 0 0;font-size:11px;line-height:1.6;color:#9ca3af;text-align:center;">
              &copy; ${new Date().getFullYear()} JUVO. All rights reserved.
            </p>

          </td>
        </tr>
      </table>

    </body>
  </html>
  `;

  await sendMailWithLogging({
    to: email,
    subject: "Your JUVO early-access invitation",
    html,
  });
}


export async function sendEmailVerificationEmail(email, token) {
  const baseUrl =
    process.env.CLIENT_URL ||
    process.env.CLIENT_ORIGIN ||
    "http://localhost:3000";

  const verificationUrl =
    `${baseUrl.replace(/\/$/, "")}/auth/verify-email/` +
    encodeURIComponent(token);

  await sendMailWithLogging({
    to: email,
    subject: "Verify your JUVO email",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; color: #0f172a;">
        <h2>Verify your JUVO email</h2>

        <p>
          Confirm your email address to unlock your JUVO account and invitation benefits.
        </p>

        <p>
          <a href="${verificationUrl}"
             style="display:inline-block;padding:12px 18px;background:#00d4ff;color:#0f172a;text-decoration:none;font-weight:bold;border-radius:999px;">
            Verify email
          </a>
        </p>

        <p>
          This link expires in 24 hours. If you did not create a JUVO account,
          you can ignore this email.
        </p>
      </div>
    `,
  });
}

export async function sendLaunchAnnouncementEmail({
  email,
  name,
  code,
  expiresAt,
  unsubscribeUrl,
  getStartedUrl,
}) {
  const safeName = String(name || "there").replace(/[<>]/g, "");

  await sendMailWithLogging({
    to: email,
    subject: "JUVO is live: your early-access invitation is ready",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto; color: #0f172a;">
        <h2>JUVO is live${safeName === "there" ? "" : `, ${safeName}`}</h2>

        <p>
          JUVO is now open. Start building a calmer, more honest trading review practice today.
        </p>

        <p>
          Your invitation includes 40% off your first successful qualifying
          subscription payment. Future payments use the normal plan price.
        </p>

        <p>
          <a href="${getStartedUrl}"
             style="display:inline-block;padding:12px 18px;background:#00d4ff;color:#0f172a;text-decoration:none;font-weight:bold;border-radius:999px;">
            Get started
          </a>
        </p>

        <p>
          Register or sign in, verify your email, and enter the invitation code
          from your original invitation email during checkout. Your invitation
          expires on ${new Date(expiresAt).toUTCString()}.
        </p>

        <p>
          <a href="${unsubscribeUrl}">
            Unsubscribe from JUVO promotional emails
          </a>
        </p>
      </div>
    `,
  });
}
