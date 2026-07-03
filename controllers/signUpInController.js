const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const db = require("../config/db");

const JWT_SECRET = 'your_secret_key';


exports.getSignUp = async (req, res) => {
    try {
        //res.render("pages/users/signUp", { title: "Signup" });
        res.render("pages/users/signUp", {
            title: "Signup",
            activePage: "Signup",
            user: null,
            redirect: req.query.redirect || "/dashboard"
        });
    } catch (err) {
        console.log(err);
    };
};

exports.postSignUp = async (req, res) => {

    const { company_name, country_id, base_currency, financial_year_start, email, password } = req.body;

    try {
        // 0. Check if this company already exists
        // const checkCompanyResult = await db.query(`SELECT * FROM companies WHERE name = $1`, [company_name]);
        // console.log("checkCompanyResult:", checkCompanyResult);

        // 1. Create company
        const companyResult = await db.query(
            `INSERT INTO companies (name, financial_year_start, country_id, base_currency)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
            [company_name, financial_year_start, country_id, base_currency]
        );

        const company_id = companyResult.rows[0].id;
        console.log("companyResult:", companyResult, "company_id:", company_id);


        // 2. Hash password
        const password_hash = await bcrypt.hash(password, 10);

        // 3. Create superuser
        await db.query(
            `INSERT INTO users (email, password_hash, company_id, role)
         VALUES ($1, $2, $3, 'superuser')`,
            [email, password_hash, company_id]
        );

        res.json({ message: 'Signup successful' });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

exports.getLogin = async (req, res) => {

    try {

        const error =
            req.session.loginError;

        delete req.session.loginError;

        if (req.headers['hx-request']) {

            return res.render(
                "pages/users/login",
                {
                    layout: false,
                    error
                }
            );
        }

        res.render(
            "pages/users/login",
            {
                title: "Login",
                activePage: "Login",
                user: null,
                error
            }
        );

    } catch (err) {

        console.log(err);

    }
};

exports.postLogin = async (req, res) => {

    const { email, password } = req.body;

    try {

        // =====================================================
        // LOAD USER + ROLE
        // =====================================================

        const result = await db.query(`
            SELECT
                u.*,
                r.role_code,
                r.role_name,
                r.role_scope
            FROM users u
            LEFT JOIN roles r
                ON r.id = u.role_id
            WHERE u.email = $1
        `, [email]);

        const user = result.rows[0];

        if (!user) {

            req.session.loginError =
                'Invalid email or password';

            return res.redirect('/login');
        }

        // =====================================================
        // PASSWORD VALIDATION
        // =====================================================

        const isMatch = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!isMatch) {

            req.session.loginError =
                'Invalid email or password';

            return res.redirect('/login');
        }

        // =====================================================
        // LOAD ROLE PERMISSIONS
        // =====================================================

        const roleResult = await db.query(`
            SELECT p.permission_code
            FROM role_permissions rp
            JOIN permissions p
                ON p.id = rp.permission_id
            WHERE rp.role_id = $1
        `, [user.role_id]);

        const rolePermissions =
            roleResult.rows.map(r => r.permission_code);

        // =====================================================
        // LOAD USER OVERRIDES
        // =====================================================

        const overrideResult = await db.query(`
            SELECT
                p.permission_code,
                up.is_allowed
            FROM user_permissions up
            JOIN permissions p
                ON p.id = up.permission_id
            WHERE up.user_id = $1
        `, [user.id]);

        // =====================================================
        // BUILD EFFECTIVE PERMISSIONS
        // =====================================================

        const permissions = new Set(rolePermissions);

        overrideResult.rows.forEach(p => {

            if (p.is_allowed) {
                permissions.add(p.permission_code);
            } else {
                permissions.delete(p.permission_code);
            }

        });


        // =====================================================
        // STORE SESSION
        // =====================================================

        req.session.user = {
            id: user.id,
            email: user.email,

            company_id: user.company_id,

            role_id: user.role_id,
            role_code: user.role_code,
            role_name: user.role_name,
            role_scope: user.role_scope,

            displayName:
                user.name ||
                user.email.split('@')[0],

            permissions: [...permissions]
        };

        
        return req.session.save(() => {
            res.redirect("/");
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
};

exports.checkCompanyExits = async (req, res) => {
    const { name } = req.query;

    if (!name) {
        return res.json({ exists: false });
    }

    const result = await db.query(
        "SELECT 1 FROM companies WHERE LOWER(name) = LOWER($1)",
        [name]
    );

    res.json({ exists: result.rowCount > 0 });
};