const express = require("express");
const router = express.Router();

// Health check route
router.get("/", (req, res) => {
  res.json({ status: "ok", message: "Backend is healthy" });
});

module.exports = router;
