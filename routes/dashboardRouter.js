const express = require("express");
const router = express.Router();

const dashboardController = require("../controllers/dashboardController");
const requireAuth = require("../middlewares/requireAuth");
const requirePermission = require("../middlewares/permissions");

router.get("/dashboard", requireAuth, requirePermission('dashboard.view'), dashboardController.getDashboard);

module.exports = router;