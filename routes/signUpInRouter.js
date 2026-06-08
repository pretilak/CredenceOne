const express = require("express");
const router = express.Router();

const signUpInController = require("../controllers/signUpInController");

router.get("/signUp", signUpInController.getSignUp);
router.post("/signUp", signUpInController.postSignUp);
router.get("/login", signUpInController.getLogin);
router.post("/login", signUpInController.postLogin);
router.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect("/");
    });
});
router.get("/api/check-company", signUpInController.checkCompanyExits);

module.exports = router;