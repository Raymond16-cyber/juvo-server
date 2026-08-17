import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

export async function sendOtpToEmail(email, otp, type) {
  let subject;
  let html;

  switch (type) {
    case "request-reset-password":
      subject = "JUVO Password Reset Code";

      html = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto;">
          <h2>Password Reset</h2>

          <p>
            We received a request to reset your JUVO password.
          </p>

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

  await transporter.sendMail({
    from: `"JUVO" <${process.env.EMAIL_USER}>`,
    to: email,
    subject,
    html,
  });

  return otp;
}
