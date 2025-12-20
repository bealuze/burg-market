const express = require("express");
const cors = require("cors");
require("dotenv").config();
require("./db");


const healthRoutes = require("./routes/health");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/health", healthRoutes);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const authRoutes = require("./routes/auth");
app.use("/api/auth", authRoutes);
