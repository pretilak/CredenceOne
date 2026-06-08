const fs = require('fs').promises;
const path = require('path');

const db = require("../config/db");

//Helper function readAccounts(company_id)
async function readAccounts(company_id) {
    try {
        const query = `SELECT * FROM accounts WHERE company_id = $1 ORDER BY acc_code ASC`;
        const data = await db.query(query, [company_id]);
        const accounts = data.rows;
        return accounts;

    } catch(err) {
        console.log(err);
    }
}

//Helper function updatedAccountDb(updatedAccount)
async function updateAccountDb(updatedAccount, newOrEdit) {
    let query = "";
    if (newOrEdit === "edit") {
        query = { text: "UPDATE accounts SET acc_name = $1 WHERE acc_code = $2", values: [updatedAccount.acc_name, updatedAccount.acc_code] };
    } else {
        query = { text: "INSERT INTO accounts (acc_name, acc_code ) VALUES ($1, $2)", values: [updatedAccount.acc_name, updatedAccount.acc_code] };
    }

    await db.query(query);
}

exports.getAccounts = async (req, res) => {
    try {
        const company_id = req.user.company_id;
        const accounts = await readAccounts(company_id);
        res.render("pages/accounts/index", { title: "Accounts", accounts: accounts });
    } catch (err) {
        res.status(500).send("Server Error");
        console.log(err);
    }
}

exports.getAccountsPage = (req, res) => {
    res.render("pages/accounts/index", { title: "Accounts", accounts: [] });
};

exports.getAccountsData = async (req, res) => {
    try {
        const company_id = req.user.company_id;
        const accounts = await readAccounts(company_id);
        res.json(accounts);
    } catch (err) {
        res.status(500).send("Server Error");
    }
};

exports.getAddEditAccount = async (req, res) => {
    try {
        let title = "";
        let newOrEdit = "";
        let account = {};
        const editAccCode = Number(req.params.acc_code);

        if (Number.isNaN(editAccCode)) {
            title = "Add Account";
            newOrEdit = "new";
            account = {acc_code:"", acc_name: ""};
        } else {
            title = "Edit Account";
            newOrEdit = "edit";            
            const accounts = await readAccounts();
            account = accounts.find(acc => Number(acc.acc_code) === editAccCode);
        }

        res.render("pages/accounts/addEditAccount", { account: account, title: title, newOrEdit: newOrEdit });
    } catch(err) {
        console.log(err);
    }
}

exports.postAddEditAccount = async (req, res) => {
    try {

        const { newOrEdit, ...newOrEditedAccount } = req.body;

        const accounts = await readAccounts();
        const index = accounts.findIndex(acc => Number(acc.acc_code) === Number(newOrEditedAccount.acc_code))

        if (index !== -1 && newOrEdit === "new") { //if adding a existing acc_code
            return res.status(500).send("This account already exists");
        };

        if (index !== -1 && newOrEdit === "edit") { //if editing a existing acc_code
            await updateAccountDb(newOrEditedAccount, newOrEdit);
        };        
        
        if (index === -1 && newOrEdit === "new") { //if adding a non-existing acc_code
            await updateAccountDb(newOrEditedAccount, newOrEdit);
        };
        
        res.redirect("/accounts");

    } catch(err) {
        console.log(err);
    }
}

exports.deleteAccount = async (req, res) => {
    const accCode = req.params.accCode;
    const query = { text: "DELETE FROM accounts WHERE acc_code = $1", values: [accCode] };

    await db.query(query);

    res.redirect("/accounts");
}
