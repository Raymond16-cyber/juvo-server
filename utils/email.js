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

export async function sendWaitlistInvitationEmail(
  email,
  name,
  code,
  expiresAt,
) {
  const safeName = String(name || "there").replace(/[<>]/g, "");

  await sendMailWithLogging({
    to: email,
    subject: "Your JUVO early-access invitation",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; color: #0f172a;">
        <h2>Welcome to JUVO${safeName === "there" ? "" : `, ${safeName}`}</h2>

        <p>Your early-access invitation code is:</p>

        <div style="font-size: 28px; font-weight: bold; letter-spacing: 4px; padding: 18px; background: #f4f4f4; text-align: center; margin: 20px 0;">
          ${code}
        </div>

        <p>
          This invitation gives you 40% off your first successful qualifying
          subscription payment. Future payments use the normal plan price.
        </p>

        <p>Your invitation expires on ${new Date(expiresAt).toUTCString()}.</p>
        <p>Use the code in JUVO after creating and verifying your account.</p>
        <p>— The JUVO Team</p>
      </div>
    `,
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
