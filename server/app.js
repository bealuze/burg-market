const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
require("./db");

const healthRoutes = require("./routes/health");
const authRoutes = require("./routes/auth");
const listingsRoutes = require("./routes/listings");
const debugRoutes = require("./routes/debug");
const { runListingCleanup } = require("./utils/listingCleanup");

const app = express();

const uploadsDir = path.join(__dirname, "uploads");

// Middleware
const allowedOrigins = [
  "https://burg-market.com",
  "https://www.burg-market.com",
  "https://api.burg-market.com",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow Safari/WebKit "null" origin
      if (!origin || origin === "null") {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json());

// Static files (dev only).
// In production we store images in R2, and we don't want the app to depend on gitignored local uploads.
if (process.env.NODE_ENV !== "production") {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
  } catch {
    // non-fatal
  }
  app.use("/uploads", express.static(uploadsDir));
}

// Routes
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api", listingsRoutes);
app.use("/api/debug", debugRoutes);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Periodic cleanup: sold (7 days) and active (30 days) + 29-day warning email
  const run = async () => {
    try {
      const result = await runListingCleanup();
      if (result.warned || result.deletedSold || result.deletedActive) {
        console.log("Cleanup complete:", result);
      }
    } catch (err) {
      console.error("Cleanup failed (non-fatal):", err.message);
    }
  };

  // TODO(bealuzenebe): Temporarily disabled startup cleanup while debugging unexpected deletions / empty listings in production.
  // Re-enable once data retention behavior is confirmed.
  // setTimeout(run, 3_000);
  setInterval(run, 60 * 60 * 1000);
});


