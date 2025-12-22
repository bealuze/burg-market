const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
require("./db");

const healthRoutes = require("./routes/health");
const authRoutes = require("./routes/auth");
const listingsRoutes = require("./routes/listings");
const { runListingCleanup } = require("./utils/listingCleanup");

const app = express();

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, "uploads");
try {
  fs.mkdirSync(uploadsDir, { recursive: true });
} catch {
  // non-fatal
}

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());

// Static files
app.use("/uploads", express.static(uploadsDir));

// Routes
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api", listingsRoutes);

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

  setTimeout(run, 3_000);
  setInterval(run, 60 * 60 * 1000);
});


