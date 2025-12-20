const nodemailer = require("nodemailer");

function makeTransporter() {
  if (
    !process.env.MAIL_HOST ||
    !process.env.MAIL_USER ||
    !process.env.MAIL_PASS
  ) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT || 587),
    secure: false,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });
}

async function sendVerificationCode(email, code) {
  try {
    const transporter = makeTransporter();

    // DEV MODE: no email credentials → just log the code
    if (!transporter) {
      console.log(`[DEV MODE] Verification code for ${email}: ${code}`);
      return;
    }

    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: "Your Gburg Hub verification code",
      text: `Your verification code is: ${code}\n\nThis code expires in 10 minutes.`,
    });
  } catch (err) {
    // CRITICAL: never crash the server because email failed
    console.error("Email sending failed (non-fatal):", err.message);
    console.log(`[DEV MODE] Verification code for ${email}: ${code}`);
  }
}

module.exports = { sendVerificationCode };
