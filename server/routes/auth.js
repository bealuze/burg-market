const express = require("express");
const router = express.Router();

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { sendVerificationCode } = require("../utils/email");



function isValidSchoolEmail(email) {
  if (!email || typeof email !== "string") return false;
  const domain = process.env.SCHOOL_DOMAIN || "gettysburg.edu";
  return email.toLowerCase().endsWith(`@${domain}`);
}

function generateCode() {
  // 6-digit code, padded
  return String(Math.floor(100000 + Math.random() * 900000));
}

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });
}

function authCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  };
}

function setAuthCookie(res, token) {
  res.cookie("token", token, {
    ...authCookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

router.post("/logout", (req, res) => {
  res.clearCookie("token", authCookieOptions());
  return res.json({ message: "Logged out." });
});

router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!isValidSchoolEmail(email)) {
      return res.status(400).json({ error: "Must use a valid school email." });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Create user if not exists
    db.run(
      `INSERT INTO users (email, password_hash, is_verified) VALUES (?, ?, 0)`,
      [email.toLowerCase(), passwordHash],
      function (err) {
        if (err) {
          // If email already exists, handle nicely
          if (String(err.message || "").includes("UNIQUE")) {
            return res.status(409).json({ error: "Account already exists. Try logging in." });
          }
          return res.status(500).json({ error: "Database error creating user." });
        }

        const userId = this.lastID;
        const code = generateCode();
        const codeHash = bcrypt.hashSync(code, 10);

        // expire in 10 minutes
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        db.run(
          `INSERT INTO email_verifications (user_id, code_hash, expires_at) VALUES (?, ?, ?)`,
          [userId, codeHash, expiresAt],
          async (err2) => {
            if (err2) return res.status(500).json({ error: "Database error creating verification." });

            await sendVerificationCode(email, code);
            return res.json({ message: "Verification code sent to your email." });
          }
        );
      }
    );
  } catch (e) {
    return res.status(500).json({ error: "Server error." });
  }
});

router.post("/verify", (req, res) => {
  const { email, code } = req.body;

  if (!isValidSchoolEmail(email)) {
    return res.status(400).json({ error: "Invalid email." });
  }
  if (!code) {
    return res.status(400).json({ error: "Code is required." });
  }

  db.get(`SELECT id, is_verified FROM users WHERE email = ?`, [email.toLowerCase()], (err, user) => {
    if (err || !user) return res.status(400).json({ error: "Account not found." });
    if (user.is_verified === 1) {
      const token = signToken({ userId: user.id, email: email.toLowerCase() });
      setAuthCookie(res, token);
      return res.json({ message: "Already verified.", token });
    }

    db.get(
      `SELECT id, code_hash, expires_at FROM email_verifications WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [user.id],
      async (err2, row) => {
        if (err2 || !row) return res.status(400).json({ error: "No verification request found." });

        const expired = new Date(row.expires_at).getTime() < Date.now();
        if (expired) return res.status(400).json({ error: "Code expired. Please register again or request a new code." });

        const ok = await bcrypt.compare(code, row.code_hash);
        if (!ok) return res.status(400).json({ error: "Invalid code." });

        db.run(`UPDATE users SET is_verified = 1 WHERE id = ?`, [user.id], (err3) => {
          if (err3) return res.status(500).json({ error: "Could not verify user." });

          // Clean up verification rows (optional but nice)
          db.run(`DELETE FROM email_verifications WHERE user_id = ?`, [user.id]);

          const token = signToken({ userId: user.id, email: email.toLowerCase() });
          setAuthCookie(res, token);
          return res.json({ message: "Email verified.", token });
        });
      }
    );
  });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!isValidSchoolEmail(email)) return res.status(400).json({ error: "Invalid email." });
  if (!password) return res.status(400).json({ error: "Password is required." });

  db.get(`SELECT id, email, password_hash, is_verified FROM users WHERE email = ?`, [email.toLowerCase()], async (err, user) => {
    if (err || !user) return res.status(401).json({ error: "Invalid credentials." });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials." });

    if (user.is_verified !== 1) {
      return res.status(403).json({ error: "Please verify your email before logging in." });
    }

    const token = signToken({ userId: user.id, email: user.email });
    setAuthCookie(res, token);
    return res.json({ message: "Logged in.", token });
  });
});

// Forgot password: check account exists, send reset code
router.post("/forgot", (req, res) => {
  const { email } = req.body || {};

  if (!isValidSchoolEmail(email)) {
    return res.status(400).json({ error: "Invalid email." });
  }

  db.get(`SELECT id FROM users WHERE email = ?`, [email.toLowerCase()], (err, user) => {
    if (err) return res.status(500).json({ error: "Database error." });
    if (!user) return res.status(404).json({ error: "Account not found." });

    const code = generateCode();
    const codeHash = bcrypt.hashSync(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    db.run(
      `INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (?, ?, ?)`,
      [user.id, codeHash, expiresAt],
      async (err2) => {
        if (err2) return res.status(500).json({ error: "Database error creating reset." });
        await sendVerificationCode(email, code);
        return res.json({ message: "Reset code sent to your email." });
      }
    );
  });
});

// Reset password: validate reset code and set new password
router.post("/reset", async (req, res) => {
  const { email, code, newPassword } = req.body || {};

  if (!isValidSchoolEmail(email)) {
    return res.status(400).json({ error: "Invalid email." });
  }
  if (!code) {
    return res.status(400).json({ error: "Code is required." });
  }
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }

  db.get(`SELECT id FROM users WHERE email = ?`, [email.toLowerCase()], (err, user) => {
    if (err) return res.status(500).json({ error: "Database error." });
    if (!user) return res.status(404).json({ error: "Account not found." });

    db.get(
      `SELECT id, code_hash, expires_at FROM password_resets WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [user.id],
      async (err2, row) => {
        if (err2) return res.status(500).json({ error: "Database error." });
        if (!row) return res.status(400).json({ error: "No reset request found." });

        const expired = new Date(row.expires_at).getTime() < Date.now();
        if (expired) return res.status(400).json({ error: "Code expired. Please request a new reset code." });

        const ok = await bcrypt.compare(code, row.code_hash);
        if (!ok) return res.status(400).json({ error: "Invalid code." });

        const passwordHash = await bcrypt.hash(newPassword, 10);
        db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [passwordHash, user.id], (err3) => {
          if (err3) return res.status(500).json({ error: "Could not update password." });
          db.run(`DELETE FROM password_resets WHERE user_id = ?`, [user.id]);
          return res.json({ message: "Password updated. Please log in." });
        });
      }
    );
  });
});

module.exports = router;
