const express = require("express");
const router = express.Router();
const accountController = require("../controllers/accountController");
const authMiddleware = require("../middlewares/authMiddleware");

router.get("/accounts", accountController.getAccountsPage);
router.get("/api/accounts", authMiddleware, accountController.getAccountsData);
router.get("/accounts/add", accountController.getAddEditAccount);
router.get("/accounts/edit/:acc_code", accountController.getAddEditAccount);
router.post("/accounts/edit", accountController.postAddEditAccount);
router.post("/accounts/delete/:accCode", accountController.deleteAccount);

module.exports = router;