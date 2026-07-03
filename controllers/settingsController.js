const db = require("../config/db");
const { getAccountEditContext } = require('../utils/accountHelper');
const { getAllowedScopes, getRolePermissions, getValidPermissions } = require('../helpers/permissionHelper');


exports.getCoa = async (req, res, updatedId = null) => {
    const companyId = req.session.user.company_id;

    const accounts = await db.query(`
    SELECT 
  a.*,

  -- check usage
  EXISTS (
    SELECT 1 FROM journal_lines jl 
    WHERE jl.account_id = a.id
  ) AS is_used,

  -- check children
  EXISTS (
    SELECT 1 FROM accounts c 
    WHERE c.parent_id = a.id
  ) AS has_children

FROM accounts a
WHERE a.company_id = $1
ORDER BY a.acc_code
  `, [companyId]);



    if (req.headers['hx-request']) {
        return res.render('pages/settings/coa', {
            layout: false,
            accounts: accounts.rows,
            updatedId
        });
    }

    res.render('pages/settings/coa', {
        title: 'Chart of Accounts',
        activePage: 'settings',
        accounts: accounts.rows,
        updatedId
    });
}

exports.getAddAccount = async (req, res) => {
    const companyId = req.session.user.company_id;

    const context = await getAccountEditContext(db, companyId);

    res.render('partials/coa-form', {
        layout: false,
        account: {},
        ...context
    });
};

// Get Edit account
exports.getEditAccount = async (req, res) => {
    const companyId = req.session.user.company_id;
    const id = req.params.id;

    const accRes = await db.query(`
    SELECT * FROM accounts
    WHERE id = $1 AND company_id = $2
  `, [id, companyId]);

    const account = accRes.rows[0];
    account.isCashOrBank = ['Cash', 'Bank'].includes(account.account_subtype);

    if (!account || account.is_system) {
        return res.status(403).send('Not allowed');
    }

    const context = await getAccountEditContext(db, companyId, account);

    res.render('partials/coa-form', {
        layout: false,
        account,
        ...context
    });
};


exports.updateAccount = async (req, res) => {
    const companyId = req.session.user.company_id;
    const id = req.params.id;

    // Fetch account
    const accRes = await db.query(`
    SELECT * FROM accounts
    WHERE id = $1 AND company_id = $2
  `, [id, companyId]);

    const account = accRes.rows[0];
    if (!account) return res.status(404).send('Account not found');

    // ❌ Block system accounts
    if (account.is_system) {
        return res.status(403).send('System accounts cannot be edited');
    }

    // Check usage
    const usage = await db.query(`
    SELECT 1 FROM journal_lines
    WHERE account_id = $1
    LIMIT 1
  `, [id]);

    const isUsed = usage.rowCount > 0;

    const { acc_name, currency_code, is_active } = req.body;

    // Determine if currency is allowed
    const isCashOrBank = ['Cash', 'Bank'].includes(account.account_subtype);

    // Build update safely
    await db.query(`
    UPDATE accounts
    SET acc_name = $1,
        currency_code = CASE 
          WHEN $2 THEN $3 
          ELSE currency_code 
        END,
        is_active = $4,
        updated_at = NOW()
    WHERE id = $5 AND company_id = $6
  `, [
        acc_name,
        isCashOrBank,                 // condition
        currency_code || null,        // new value
        is_active === 'on',
        id,
        companyId
    ]);

    // Reload COA (IMPORTANT: no redirect)
    const result = await db.query(`
    SELECT * FROM accounts
    WHERE company_id = $1
    ORDER BY acc_code
  `, [companyId]);

    return exports.getCoa(
        req,
        res,
        req.params.id
    );
/*     res.render('pages/settings/coa', {
        accounts: result.rows,
        layout: false   // ensures HTMX swap works cleanly
    });
 */};

// Helper to populate the Parent dropdown based on account type selected
exports.getParentsByType = async (req, res) => {
    const companyId = req.session.user.company_id;
    const { account_type } = req.query;

    const result = await db.query(`
    SELECT id, acc_name, account_subtype
    FROM accounts
    WHERE company_id = $1
      AND account_type = $2
      AND is_postable = false
    ORDER BY acc_code
  `, [companyId, account_type]);

    res.render('partials/parent-options', {
        parents: result.rows,
        layout: false   // 🔥 VERY IMPORTANT for HTMX
    });
};

exports.createAccount = async (req, res) => {
    const companyId = req.session.user.company_id;

    const {
        acc_code: new_acc_code,
        acc_name,
        account_type,
        parent_id,
        currency_code,
        is_active
    } = req.body;

    // -------------------------------
    // 1. Validate required
    // -------------------------------
    if (!acc_name || !account_type || !parent_id) {
        return res.status(400).send('Missing required fields');
    }

    // -------------------------------
    // 2. Get parent
    // -------------------------------
    const parentRes = await db.query(`
    SELECT acc_code, account_type, account_subtype
    FROM accounts
    WHERE id = $1 AND company_id = $2
  `, [parent_id, companyId]);

    const parent = parentRes.rows[0];

    if (!parent) {
        return res.status(400).send('Invalid parent');
    }

    // -------------------------------
    // 3. Type consistency
    // -------------------------------
    if (parent.account_type !== account_type) {
        return res.status(400).send('Account type must match parent');
    }

    // -------------------------------
    // 4. Currency logic
    // -------------------------------
    let finalCurrency = null;

    if (parent.account_subtype === 'Bank' || parent.account_subtype === 'Cash') {
        if (!currency_code) {
            return res.status(400).send('Currency required for Bank/Cash accounts');
        }
        finalCurrency = currency_code;
    }

    // -------------------------------
    // 5. Insert
    // -------------------------------

    const result = await db.query(`
    INSERT INTO accounts
    (acc_code, acc_name, company_id, account_type, parent_id, currency_code, is_postable, is_active, is_system)
    VALUES ($1,$2,$3,$4,$5,$6,true,$7,false) RETURNING id
  `, [
        new_acc_code,
        acc_name,
        companyId,
        account_type,
        parent_id,
        finalCurrency,
        is_active === 'on'
    ]);

    // -------------------------------
    // 6. Reload COA
    // -------------------------------
    //res.redirect('/settings/coa');
    return exports.getCoa(
        req,
        res,
        result.rows[0].id
    );
};

//Function to get nextCode
exports.getNextCode = async (req, res) => {
    //console.log("Inside getNextCode");
    const companyId = req.session.user.company_id;
    const { parent_id } = req.query;

    if (!parent_id) return res.send('');

    // 1. Get parent
    const parentRes = await db.query(`
    SELECT acc_code
    FROM accounts
    WHERE id = $1 AND company_id = $2
  `, [parent_id, companyId]);

    const parent = parentRes.rows[0];
    if (!parent) return res.send('');

    // 3. Get max child
    const lastChild = await db.query(`
    SELECT MAX(acc_code) AS max_code
    FROM accounts
    WHERE parent_id = $1 AND company_id = $2
  `, [parent_id, companyId]);

    //Helper function for nextCode
    function findHirarchyLevel(acc_code, level = 0, step = 1000) {
        let reminder = acc_code - Math.trunc(acc_code / step) * step;

        if (reminder == 0 && step == 1) { return step; }
        if (reminder == 0 && step >= 10) { return step / 10; }
        else {
            return findHirarchyLevel(reminder, level + 1, step / 10);
        }
    }

    function nextCode(parent_code, lastCode) {
        lastCode = lastCode ?? parent_code;
        const nextCode = lastCode + findHirarchyLevel(parent_code);
        return nextCode;
    }

    // 4. Return ONLY value (HTMX will inject)nextCode
    res.send(`
  <input id="acc_code" name="acc_code" value="${nextCode(parent.acc_code, lastChild.rows[0].max_code)}" readonly />
`);
};

exports.deleteAccount = async (req, res) => {

    const companyId = req.session.user.company_id;
    const id = req.params.id;

    //console.log("Delete acc id:", id);

    // -------------------------------
    // 1. Fetch account
    // -------------------------------
    const accRes = await db.query(`
    SELECT *
    FROM accounts
    WHERE id = $1 AND company_id = $2
  `, [id, companyId]);

    const account = accRes.rows[0];
    if (!account) {
        return res.status(404).send('Account not found');
    }

    // -------------------------------
    // 2. Block system accounts
    // -------------------------------
    if (account.is_system) {
        return res.status(403).send('System accounts cannot be deleted');
    }

    // -------------------------------
    // 3. Check usage
    // -------------------------------
    const usage = await db.query(`
    SELECT 1 FROM journal_lines
    WHERE account_id = $1
    LIMIT 1
  `, [id]);

    if (usage.rowCount > 0) {
        return res.status(400).send('Account is in use and cannot be deleted');
    }

    // -------------------------------
    // 4. Check children
    // -------------------------------
    const children = await db.query(`
    SELECT 1 FROM accounts
    WHERE parent_id = $1
    LIMIT 1
  `, [id]);

    if (children.rowCount > 0) {
        return res.status(400).send('Account has child accounts');
    }

    // -------------------------------
    // 5. Delete
    // -------------------------------
    await db.query(`
    DELETE FROM accounts
    WHERE id = $1 AND company_id = $2
  `, [id, companyId]);

    // -------------------------------
    // 6. Reload COA (HTMX)
    // -------------------------------
    res.set('HX-Redirect', '/settings/coa');
    res.send();
};


// Entities
exports.getEntities = async (req, res, updatedId = null) => {

    try {

        const result = await db.query(`
            SELECT
                e.*,
                f.name AS default_forwarder_name,
                COALESCE(c.contact_count, 0) AS contact_count

            FROM entities e

            LEFT JOIN entities f
                ON e.default_forwarder_id = f.id

            LEFT JOIN (
                SELECT
                    entity_id,
                    COUNT(*) AS contact_count
                FROM entity_contacts
                GROUP BY entity_id
            ) c
                ON c.entity_id = e.id

            WHERE e.company_id = $1

            ORDER BY e.name
        `, [req.session.user.company_id]);

        if (req.headers['hx-request']) {
            return res.render('pages/settings/entities', {
                layout: false,
                entities: result.rows,
                activePage: 'entities',
                updatedId
            });
        }

        res.render('pages/settings/entities', {
            title: 'Entities',
            activePage: 'entities',
            entities: result.rows,
            updatedId
        });

    } catch (err) {

        console.error(err);

        res.status(500).send(err.message);
    }
};

exports.getAddEntity = async (req, res) => {

    const logistics = await db.query(
        `
        SELECT id, name
        FROM entities
        WHERE company_id = $1
        AND entity_type = 'logistics'
        AND is_active = true
        ORDER BY name
        `,
        [req.session.user.company_id]
    );

    res.render(
        'partials/entity-form',
        {
            isEdit: false,
            entity: {},
            logisticsEntities: logistics.rows
        }
    );
};

exports.createEntity = async (req, res) => {
    try {
        const {
            name,
            entity_type,
            email,
            phone,
            tax_id,
            currency_code,
            default_forwarder_id,
            forwarder_account_no,
            is_active
        } = req.body;

        const result = await db.query(
            `
            INSERT INTO entities
            (
                company_id,
                name,
                entity_type,
                email,
                phone,
                tax_id,
                currency_code,
                default_forwarder_id,
                forwarder_account_no,
                is_active
            )

            VALUES
            (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10
            )
            RETURNING id
            `,

            [
                req.session.user.company_id,
                name,
                entity_type,
                email || null,
                phone || null,
                tax_id || null,
                currency_code || null,
                default_forwarder_id || null,
                forwarder_account_no || null,
                is_active === 'on'
            ]
        );


        return exports.getEntities(
            req,
            res,
            result.rows[0].id
        );
    }

    catch (err) {
        console.error(err);
        res
            .status(500)
            .send(
                'Error creating entity'
            );
    }
};

exports.getEditEntity = async (req, res) => {
    try {
        const entity =
            await db.query(
                `
                SELECT *
                FROM entities
                WHERE
                    id = $1
                AND
                    company_id = $2
                `,
                [
                    req.params.id,
                    req.session.user.company_id
                ]
            );
        if (
            !entity.rows.length
        ) {
            return res
                .status(404)
                .send(
                    'Entity not found'
                );
        }

        const logistics =
            await db.query(
                `
                SELECT
                    id,
                    name

                FROM entities
                WHERE
                    company_id = $1
                AND
                    entity_type =
                    'logistics'
                ORDER BY
                    name
                `,
                [
                    req.session.user.company_id
                ]
            );

        res.render(
            'partials/entity-form',
            {
                isEdit:
                    true,
                entity:
                    entity.rows[0],
                logisticsEntities:
                    logistics.rows
            }
        );
    }

    catch (err) {
        console.error(
            err
        );

        res.status(500).send(err.message);
    }
};

exports.updateEntity = async (req, res) => {
    try {
        const {
            name,
            entity_type,
            email,
            phone,
            tax_id,
            currency_code,
            default_forwarder_id,
            forwarder_account_no,
            is_active
        }
            =
            req.body;

        await db.query(`UPDATE entities
            SET
            name=$1,
            entity_type=$2,
            email=$3,
            phone=$4,
            tax_id=$5,
            currency_code=$6,
            default_forwarder_id=$7,
            forwarder_account_no=$8,
            is_active=$9

            WHERE id=$10 AND company_id=$11`,

            [
                name,
                entity_type,
                email || null,
                phone || null,
                tax_id || null,
                currency_code || null,
                default_forwarder_id || null,
                forwarder_account_no || null,
                is_active === 'on',
                req.params.id,
                req.session.user.company_id
            ]
        );

        return exports.getEntities(
            req,
            res,
            req.params.id
        );
    }

    catch (err) {
        console.error(
            err
        );

        res
            .status(500)
            .send(
                'Update failed'
            );
    }
};

exports.deleteEntity = async (req, res) => {

    try {

        const companyId =
            req.session.user.company_id;

        await db.query(
            `
            DELETE FROM entities
            WHERE id = $1
            AND company_id = $2
            `,
            [req.params.id, companyId]
        );

        return exports.getEntities(req, res);

    } catch (err) {
        console.error(err);
        return res
            .status(500)
            .send('Delete failed');
    }
};

//Entity_contacts
exports.getEntityContacts = async (req, res, updatedId = null) => {

    const companyId =
        req.session.user.company_id;

    const entityId =
        req.params.entityId || req.params.id;

    const entity =
        await db.query(
            `
            SELECT
                id,
                name,
                entity_type
            FROM entities
            WHERE id = $1
            AND company_id = $2
            `,
            [entityId, companyId]
        );

    if (!entity.rows.length) {

        return res
            .status(404)
            .send('Entity not found');

    }

    const contacts =
        await db.query(
            `
            SELECT *
            FROM entity_contacts
            WHERE entity_id = $1
            ORDER BY
                is_primary DESC,
                contact_name
            `,
            [entityId]
        );

    if (req.headers['hx-request']) {

        return res.render(
            'pages/settings/entity-contacts',
            {
                layout: false,
                entity: entity.rows[0],
                contacts: contacts.rows,
                updatedId
            }
        );

    }

    res.render(
        'pages/settings/entity-contacts',
        {
            title: 'Contacts',
            activePage: 'entities',
            entity: entity.rows[0],
            contacts: contacts.rows,
            updatedId
        }
    );

};

exports.getAddContact = async (req, res) => {

    res.render(
        'partials/contact-form',
        {
            layout: false,
            isEdit: false,
            entityId: req.params.entityId,
            contact: {}
        }
    );
};

exports.createContact = async (req, res) => {

    try {

        const {
            contact_name,
            designation,
            email,
            mobile,
            phone,
            remarks
        } = req.body;

        const entityId =
            req.params.entityId;

        const companyId =
            req.session.user.company_id;

        const isPrimary =
            req.body.is_primary === 'on';

        const isActive =
            req.body.is_active === 'on';

        if (isPrimary) {

            await db.query(
                `
                UPDATE entity_contacts
                SET is_primary = false
                WHERE entity_id = $1
                `,
                [entityId]
            );
        }

        const result =
            await db.query(
                `
                INSERT INTO entity_contacts
                (
                    entity_id,
                    company_id,
                    contact_name,
                    designation,
                    email,
                    mobile,
                    phone,
                    remarks,
                    is_primary,
                    is_active
                )
                VALUES
                (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
                )
                RETURNING id
                `,
                [
                    entityId,
                    companyId,
                    contact_name,
                    designation || null,
                    email || null,
                    mobile || null,
                    phone || null,
                    remarks || null,
                    isPrimary,
                    isActive
                ]
            );

        return exports.getEntityContacts(
            req,
            res,
            result.rows[0].id
        );

    } catch (err) {

        console.error(err);

        return res
            .status(500)
            .send('Create Contact failed');
    }
};

exports.getEditContact = async (req, res) => {

    const companyId =
        req.session.user.company_id;

    const result =
        await db.query(
            `
            SELECT *
            FROM entity_contacts
            WHERE id = $1
            AND company_id = $2
            `,
            [
                req.params.id,
                companyId
            ]
        );

    if (!result.rows.length) {

        return res
            .status(404)
            .send('Contact not found');

    }

    res.render(
        'partials/contact-form',
        {
            layout: false,
            isEdit: true,
            contact: result.rows[0],
            entityId: result.rows[0].entity_id
        }
    );

};

exports.updateContact = async (req, res) => {

    try {

        const companyId =
            req.session.user.company_id;

        const {

            contact_name,
            designation,
            email,
            mobile,
            phone,
            remarks

        } = req.body;

        const isPrimary =
            req.body.is_primary === 'on';

        const isActive =
            req.body.is_active === 'on';

        const contactResult =
            await db.query(
                `
                SELECT
                    id,
                    entity_id
                FROM entity_contacts
                WHERE id = $1
                AND company_id = $2
                `,
                [
                    req.params.id,
                    companyId
                ]
            );

        if (!contactResult.rows.length) {

            return res
                .status(404)
                .send('Contact not found');

        }

        const entityId =
            contactResult.rows[0].entity_id;

        if (isPrimary) {

            await db.query(
                `
                UPDATE entity_contacts
                SET is_primary = false
                WHERE entity_id = $1
                `,
                [entityId]
            );

        }

        await db.query(
            `
            UPDATE entity_contacts
            SET
                contact_name = $1,
                designation = $2,
                email = $3,
                mobile = $4,
                phone = $5,
                remarks = $6,
                is_primary = $7,
                is_active = $8
            WHERE id = $9
            `,
            [
                contact_name,
                designation || null,
                email || null,
                mobile || null,
                phone || null,
                remarks || null,
                isPrimary,
                isActive,
                req.params.id
            ]
        );

        req.params.entityId =
            entityId;

        return exports.getEntityContacts(
            req,
            res,
            req.params.id
        );

    } catch (err) {

        console.error(err);

        return res
            .status(500)
            .send('Update failed');

    }

};

exports.deleteContact = async (req, res) => {

    try {

        const companyId =
            req.session.user.company_id;

        const contact =
            await db.query(
                `
                SELECT
                    id,
                    entity_id
                FROM entity_contacts
                WHERE id = $1
                AND company_id = $2
                `,
                [
                    req.params.id,
                    companyId
                ]
            );

        if (!contact.rows.length) {

            return res
                .status(404)
                .send('Contact not found');

        }

        const entityId =
            contact.rows[0].entity_id;

        await db.query(
            `
            DELETE FROM entity_contacts
            WHERE id = $1
            AND company_id = $2
            `,
            [
                req.params.id,
                companyId
            ]
        );

        req.params.entityId =
            entityId;

        return exports.getEntityContacts(
            req,
            res
        );

    } catch (err) {

        console.error(err);

        return res
            .status(500)
            .send('Delete failed');

    }

};

//Roles
exports.getRoles = async (req, res, updatedId = null) => {

    const currentRole =
        req.session.user.role_code;

    let query = `
    SELECT
        r.*,

        EXISTS (
            SELECT 1
            FROM users u
            WHERE u.role_id = r.id
        ) AS has_users

    FROM roles r
`;

    if (currentRole === 'superuser') {

        query += `
        WHERE r.role_scope = 'company'
    `;

    } else if (currentRole === 'appadmin') {

        // show all roles

    } else {

        return res
            .status(403)
            .send('Access denied');

    }

    query += `
    ORDER BY role_code
`;

    const result = await db.query(query);

    if (req.headers['hx-request']) {

        return res.render(
            'pages/settings/roles',
            {
                layout: false,
                activePage: 'roles',
                roles: result.rows,
                updatedId
            }
        );

    }

    res.render(
        'pages/settings/roles',
        {
            title: 'Roles',
            activePage: 'roles',
            roles: result.rows,
            updatedId
        }
    );
};

exports.getAddRole = async (req, res) => {
    res.render(
        'partials/role-form',
        {
            layout: false,
            isEdit: false,
            role: {}
        }
    );
};

exports.createRole = async (req, res) => {

    try {

        const roleCode =
            req.body.role_code
                .trim()
                .toLowerCase();

        const roleName =
            req.body.role_name
                .trim();

        const isActive =
            req.body.is_active === 'on';

        const existing =
            await db.query(
                `
                SELECT id
                FROM roles
                WHERE LOWER(role_code) = LOWER($1)
                `,
                [roleCode]
            );

        if (existing.rows.length) {

            return res
                .status(400)
                .send('Role code already exists');

        }

        const result =
            await db.query(
                `
                INSERT INTO roles
                (
                    role_code,
                    role_name,
                    is_active,
                    is_system
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    false
                )
                RETURNING id
                `,
                [
                    roleCode,
                    roleName,
                    isActive
                ]
            );

        return exports.getRoles(
            req,
            res,
            result.rows[0].id
        );

    } catch (err) {

        console.error(err);

        return res
            .status(500)
            .send('Error creating role');

    }

};

exports.getEditRole = async (req, res) => {

    const result =
        await db.query(
            `
            SELECT *
            FROM roles
            WHERE id = $1
            `,
            [req.params.id]
        );

    if (!result.rows.length) {

        return res
            .status(404)
            .send('Role not found');

    }

    if (result.rows[0].is_system) {

        return res
            .status(403)
            .send('System roles cannot be edited');

    }

    res.render(
        'partials/role-form',
        {
            layout: false,
            isEdit: true,
            role: result.rows[0]
        }
    );

};

exports.updateRole = async (req, res) => {

    try {

        const roleId = req.params.id;

        const role = await db.query(
            `
            SELECT *
            FROM roles
            WHERE id = $1
            `,
            [roleId]
        );

        if (!role.rows.length) {

            return res
                .status(404)
                .send('Role not found');

        }

        if (role.rows[0].is_system) {

            return res
                .status(403)
                .send('System roles cannot be edited');

        }

        const roleCode =
            req.body.role_code
                .trim()
                .toLowerCase();

        const roleName =
            req.body.role_name
                .trim();

        const isActive =
            req.body.is_active === 'on';

        const duplicate = await db.query(
            `
            SELECT id
            FROM roles
            WHERE LOWER(role_code) = LOWER($1)
            AND id <> $2
            `,
            [
                roleCode,
                roleId
            ]
        );

        if (duplicate.rows.length) {

            return res
                .status(400)
                .send('Role code already exists');

        }

        await db.query(
            `
            UPDATE roles
            SET
                role_code = $1,
                role_name = $2,
                is_active = $3
            WHERE id = $4
            `,
            [
                roleCode,
                roleName,
                isActive,
                roleId
            ]
        );

        return exports.getRoles(
            req,
            res,
            roleId
        );

    } catch (err) {

        console.error(err);

        return res
            .status(500)
            .send('Error updating role');

    }

};

exports.deleteRole = async (req, res) => {

    try {

        const role = await db.query(
            `
            SELECT
                r.*,

                EXISTS (
                    SELECT 1
                    FROM users u
                    WHERE u.role_id = r.id
                ) AS has_users

            FROM roles r

            WHERE r.id = $1
            `,
            [req.params.id]
        );

        if (!role.rows.length) {

            return res
                .status(404)
                .send('Role not found');

        }

        if (role.rows[0].is_system) {

            return res
                .status(403)
                .send('System roles cannot be deleted');

        }

        if (role.rows[0].has_users) {

            return res
                .status(403)
                .send('Role is assigned to users');

        }

        await db.query(
            `
            DELETE
            FROM roles
            WHERE id = $1
            `,
            [req.params.id]
        );

        return exports.getRoles(
            req,
            res
        );

    } catch (err) {

        console.error(err);

        return res
            .status(500)
            .send('Error deleting role');

    }

};

//Users
exports.getUsers = async (req, res, updatedId = null) => {

    const currentRole =
        req.session.user.role_code;

    const currentCompanyId =
        req.session.user.company_id;

    let query = `
        SELECT
            u.id,
            u.name,
            u.email,
            u.company_id,
            c.name AS company_name,
            u.is_active,
            u.is_2fa_enabled,
            r.role_code,
            r.role_name,
            r.role_scope

        FROM users u

        JOIN roles r
            ON r.id = u.role_id

        LEFT JOIN companies c
            ON c.id = u.company_id
        
        WHERE r.role_code <> 'appadmin'
    `;

    const params = [];

    if (currentRole === 'appadmin') {

        // See everything

    } else if (currentRole === 'superuser') {

        query += `
            AND r.role_scope = 'company'
        `;

    } else if (currentRole === 'companyadmin') {

        query += `
            AND u.company_id = $1
            AND r.role_code NOT IN ('companyadmin')
        `;

        params.push(currentCompanyId);

    } else {

        return res
            .status(403)
            .send('Access denied');

    }

    query += `
        ORDER BY
            c.name NULLS FIRST,
            u.name,
            u.email
    `;

    //console.log(query);

    const result =
        await db.query(
            query,
            params
        );

    //console.log("User:", result.rows);

    if (req.headers['hx-request']) {

        return res.render(
            'pages/settings/users',
            {
                layout: false,
                activePage: 'users',
                users: result.rows,
                updatedId
            }
        );

    }

    res.render(
        'pages/settings/users',
        {
            title: 'Users',
            activePage: 'users',
            users: result.rows,
            updatedId
        }
    );

};

exports.getAddUser = async (req, res) => {

    const roles =
        await db.query(`
            SELECT
                id,
                role_name,
                role_code,
                role_scope
            FROM roles
            WHERE
            (
                $1 = 'appadmin'
                AND role_code <> 'appadmin'
            )
            OR
            (
                $1 = 'superuser'
                AND role_scope = 'company'
            )
            OR
            (
                $1 = 'companyadmin'
                AND role_scope = 'company'
                AND role_code <> 'companyadmin'
            )
            ORDER BY role_name;
            `, [req.session.user.role_code]);

    const companies =
        await db.query(`
            SELECT
                id,
                name
            FROM companies
            ORDER BY name
        `);

    const companyId = req.query.companyId || '';

    const isCompanyAdmin = req.session.user.role_code === 'companyadmin';

    showCompanyField = req.session.user.role_scope === 'platform';

    //console.log("roleScope:", roleScope);

    res.render(
        'partials/user-form1',
        {
            layout: false,
            isEdit: false,
            user: {},
            roles: roles.rows,
            showCompanyField,
            companies: companies.rows,
            companyId: isCompanyAdmin ? req.session.user.company_id : companyId,
        }
    );

};

const bcrypt = require('bcrypt');

exports.createUser = async (req, res) => {

    //console.log(req.body);

    try {

        const {
            name,
            email,
            company_id,
            role_id,
            password,
            confirm_password,
            is_active
        } = req.body;

        // ==========================
        // Password validation
        // ==========================

        if (password !== confirm_password) {

            return res
                .status(400)
                .send('Passwords do not match');

        }

        // ==========================
        // Email uniqueness
        // ==========================

        const existingUser =
            await db.query(
                `
                SELECT id
                FROM users
                WHERE lower(email) =
                      lower($1)
                `,
                [email]
            );

        if (existingUser.rows.length) {

            return res
                .status(400)
                .send('Email already exists');

        }

        // ==========================
        // Get role
        // ==========================

        const roleResult =
            await db.query(
                `
                SELECT
                    id,
                    role_scope
                FROM roles
                WHERE id = $1
                `,
                [role_id]
            );

        if (!roleResult.rows.length) {

            return res
                .status(400)
                .send('Invalid role');

        }

        const role =
            roleResult.rows[0];

        // ==========================
        // Company validation
        // ==========================

        let finalCompanyId = null;

        if (role.role_scope === 'company') {

            if (!company_id) {

                return res
                    .status(400)
                    .send(
                        'Company is required'
                    );

            }

            finalCompanyId =
                company_id;

        }

        // ==========================
        // Password hash
        // ==========================

        const passwordHash =
            await bcrypt.hash(
                password,
                10
            );

        // ==========================
        // Insert
        // ==========================

        const result = await db.query(
            `
            INSERT INTO users
            (
                name,
                email,
                company_id,
                role_id,
                password_hash,
                is_active
            )
            VALUES
            (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6
            ) RETURNING id
            `,
            [
                name,
                email,
                finalCompanyId,
                role_id,
                passwordHash,
                is_active === 'on'
            ]
        );

        const returnCompanyId = req.body.return_company_id;

        req.session.updatedId = result.rows[0].id;

        if (returnCompanyId) {

            req.params.id = returnCompanyId;

            return exports.getCompanyUsers(
                req,
                res
            );

        }

        return exports.getUsers(
            req,
            res
        );

    } catch (err) {

        console.error(err);

        return res
            .status(500)
            .send(
                'Error creating user'
            );

    }

};

exports.getEditUser = async (req, res) => {

    const userId = req.params.id;

    const userResult =
        await db.query(
            `
            SELECT
                u.*,
                r.role_scope,
                r.role_code
            FROM users u
            JOIN roles r
                ON r.id = u.role_id
            WHERE u.id = $1
            `,
            [userId]
        );

    if (!userResult.rows.length) {
        return res
            .status(404)
            .send('User not found');
    }

    const user = userResult.rows[0];
    
    if (user.role_code === 'appadmin') {
        return res
            .status(403)
            .send('Application Administrator cannot be edited.');
    }

    const companyId = user.companyId;

        const roles =
        await db.query(`
            SELECT
                id,
                role_name,
                role_code,
                role_scope
            FROM roles
            WHERE
            (
                $1 = 'appadmin'
                AND role_code <> 'appadmin'
            )
            OR
            (
                $1 = 'superuser'
                AND role_scope = 'company'
            )
            OR
            (
                $1 = 'companyadmin'
                AND role_scope = 'company'
                AND role_code <> 'companyadmin'
            )
            ORDER BY role_name;
            `, [req.session.user.role_code]);


    const companies =
        await db.query(`
            SELECT
                id,
                name
            FROM companies
            ORDER BY name
        `);

    const isCompanyAdmin = req.session.user.role_code === 'companyadmin';

    res.render(
        'partials/user-form1',
        {
            layout: false,
            isEdit: true,
            user,
            roles: roles.rows,
            companies: companies.rows,
            showCompanyField: !isCompanyAdmin,
            companyId: user.companyId || ''
        }
    );

};

exports.updateUser = async (req, res) => {

    try {

        const userId =
            req.params.id;

        const {
            name,
            role_id,
            is_active,
            email
        } = req.body;

        const existingEmailUser =
            await db.query(
                `
        SELECT id
        FROM users
        WHERE lower(email) = lower($1)
        AND id <> $2
        `,
                [
                    email,
                    userId
                ]
            );


        if (existingEmailUser.rows.length) {

            return res
                .status(400)
                .send('Email already exists');

        }

        const existingUser =
            await db.query(
                `
                SELECT
                    u.*,
                    r.role_scope,
                    r.role_code
                FROM users u
                JOIN roles r
                    ON r.id = u.role_id
                WHERE u.id = $1
                `,
                [userId]
            );

        if (existingUser.role_code === 'appadmin') {
            return res
                .status(403)
                .send('Application Administrator cannot be modified.');
        }

        if (!existingUser.rows.length) {
            return res
                .status(404)
                .send('User not found');
        }

        const currentUser =
            existingUser.rows[0];

        const newRole =
            await db.query(
                `
                SELECT
                    id,
                    role_scope
                FROM roles
                WHERE id = $1
                `,
                [role_id]
            );

        if (!newRole.rows.length) {

            return res
                .status(400)
                .send('Invalid role');

        }

        // Prevent scope changes
        if (
            currentUser.role_scope !==
            newRole.rows[0].role_scope
        ) {

            return res
                .status(400)
                .send(
                    'Role scope cannot be changed'
                );

        }

        const result = await db.query(
            `
            UPDATE users
            SET
                name = $1,
                role_id = $2,
                is_active = $3,
                email = $4
            WHERE id = $5
            RETURNING id;
            `,
            [
                name,
                role_id,
                is_active === 'on',
                email,
                userId
            ]
        );

        const returnCompanyId = req.body.company_id;

        //console.log("returnCompanyId:", returnCompanyId);

        req.session.updatedId = result.rows[0].id;

        if (returnCompanyId) {

            req.params.id = returnCompanyId;

            return exports.getCompanyUsers(
                req,
                res
            );

        }

        return exports.getUsers(
            req,
            res,
            userId
        );

    } catch (err) {

        console.error(err);

        return res
            .status(500)
            .send('Error updating user');

    }

};

exports.validateEmail = async (req, res) => {

    const {
        email,
        user_id
    } = req.body;

    if (
        email.trim() === '' 
        ) {
            return res.send('&nbsp;');
        }

    if (user_id) {

        const currentUser =
            await db.query(
                `
            SELECT email
            FROM users
            WHERE id = $1
            `,
                [user_id]
            );
        
        if (
            currentUser.rows.length &&
            currentUser.rows[0].email.toLowerCase() ===
            email.toLowerCase()
        ) {

            return res.send('&nbsp;');
        }

    }

    const result =
        await db.query(
            `
            SELECT id
            FROM users
            WHERE lower(email) =
                  lower($1)
            AND id <> COALESCE($2, -1)
            `,
            [
                email,
                user_id || null
            ]
        );

    if (result.rows.length) {

        return res.send(`
            <span class="validation-error">
                Email already exists
            </span>
        `);

    }

    return res.send(`
        <span class="validation-success">
            Email available
        </span>
    `);

};


exports.getEditUserPermissions = async (req, res) => {

    try {

        const userId = req.params.id;

        //====================================================
        // Get User
        //====================================================

        const userResult = await db.query(
            `
            SELECT
                u.id,
                u.name,
                u.email,
                u.role_id,
                r.role_name,
                r.role_code,
                r.role_scope
            FROM users u
            JOIN roles r
                ON r.id = u.role_id
            WHERE u.id = $1
            `,
            [userId]
        );

        if (userResult.rows.length === 0) {

            return res
                .status(404)
                .send("User not found");

        }

        const user =
            userResult.rows[0];

        //====================================================
        // Determine Applicable Permission Scopes
        //====================================================

/*         const allowedScopes =
            user.role_scope === 'platform'
                ? ['platform', 'both']
                : ['company', 'both']; */

        const allowedScopes =
            getAllowedScopes(user.role_scope);

        //====================================================
        // Get Effective Permissions
        //====================================================

        const permissionResult =
            await db.query(
                `
                SELECT

                    p.id,
                    p.module_name,
                    p.permission_name,
                    p.permission_code,
                    p.delegation_scope,

                    CASE

                        WHEN up.is_allowed IS NOT NULL
                            THEN up.is_allowed

                        WHEN rp.permission_id IS NOT NULL
                            THEN true

                        ELSE false

                    END AS assigned

                FROM permissions p

                LEFT JOIN role_permissions rp
                    ON rp.permission_id = p.id
                   AND rp.role_id = $1

                LEFT JOIN user_permissions up
                    ON up.permission_id = p.id
                   AND up.user_id = $2

                WHERE p.delegation_scope = ANY($3)

                ORDER BY
                    p.module_name,
                    CASE split_part(p.permission_name, ' ', 1)
                        WHEN 'View' THEN 1
                        WHEN 'Create' THEN 2
                        WHEN 'Edit' THEN 3
                        WHEN 'Delete' THEN 4
                        ELSE 99
                    END,
                    p.permission_name
                `,
                [
                    user.role_id,
                    userId,
                    allowedScopes
                ]
            );

        //====================================================
        // Group by Module
        //====================================================

        const groupedPermissions = {};

        permissionResult.rows.forEach(permission => {

            if (
                !groupedPermissions[
                    permission.module_name
                ]
            ) {

                groupedPermissions[
                    permission.module_name
                ] = [];

            }

            groupedPermissions[
                permission.module_name
            ].push(permission);

        });

        //====================================================
        // Render
        //====================================================

        const viewData = {

            user: req.session.user,
            selectedUser: user,
            groupedPermissions

        };

        if (req.headers['hx-request']) {

            return res.render(
                'pages/settings/user-permissions',
                {
                    layout: false,
                    ...viewData
                }
            );

        }

        return res.render(
            'pages/settings/user-permissions',
            {
                title: 'User Permissions',
                activePage: 'Users',
                ...viewData
            }
        );

    }
    catch (err) {

        console.error(err);

        return res
            .status(500)
            .send("Error loading user permissions");

    }

};


exports.postEditUserPermissions = async (req, res) => {

    const client = await db.connect();

    try {

        await client.query("BEGIN");

        const userId = req.params.id;

        //====================================================
        // Selected Permissions
        //====================================================

        const selectedPermissionSet = new Set(
            [].concat(req.body.permissions || []).map(Number)
        );

        //====================================================
        // Get User Role
        //====================================================

        const userResult = await client.query(
            `
            SELECT
                role_id,
                r.role_scope
            FROM users u
            JOIN roles r
                ON r.id = u.role_id
            WHERE u.id = $1
            `,
            [userId]
        );

        if (userResult.rows.length === 0) {

            throw new Error("User not found");

        }

        const {
            role_id: roleId,
            role_scope: roleScope
        } = userResult.rows[0];

        const allowedScopes =
            getAllowedScopes(roleScope);

        //====================================================
        // Get Role Permissions
        //====================================================

        const rolePermissions = await getRolePermissions(client, roleId, allowedScopes);

        //====================================================
        // Get Valid Permission IDs
        //====================================================

        const validPermissions = await getValidPermissions(client, allowedScopes);

/*         const permissionResult =
            await client.query(
                `
                SELECT id

                FROM permissions

                WHERE delegation_scope = ANY($1)
                `,
                [allowedScopes]
            );

        const validPermissionSet = new Set(
            permissionResult.rows.map(r =>
                Number(r.id)
            )
        );
 */
        //====================================================
        // Build Overrides
        //====================================================

        const permissionIds = new Set([
            ...rolePermissions,
            ...selectedPermissionSet
        ]);

        const values = [];

        for (const permissionId of permissionIds) {

            // Ignore invalid/tampered permissions

            if (!validPermissions.has(permissionId)) {

                continue;

            }

            const roleHasPermission =
                rolePermissions.has(permissionId);

            const userHasPermission =
                selectedPermissionSet.has(permissionId);

            // Store only differences

            if (roleHasPermission !== userHasPermission) {

                values.push([
                    userId,
                    permissionId,
                    userHasPermission
                ]);

            }

        }

        //====================================================
        // Replace Existing Overrides
        //====================================================

        await client.query(
            `
            DELETE
            FROM user_permissions
            WHERE user_id = $1
            `,
            [userId]
        );

        //====================================================
        // Bulk Insert
        //====================================================

        if (values.length > 0) {

            const placeholders = values
                .map((_, i) => {

                    const p = i * 3;

                    return `($${p + 1}, $${p + 2}, $${p + 3})`;

                })
                .join(", ");

            const params =
                values.flat();

            await client.query(
                `
                INSERT INTO user_permissions
                (
                    user_id,
                    permission_id,
                    is_allowed
                )
                VALUES
                ${placeholders}
                `,
                params
            );

        }

        await client.query("COMMIT");

        return this.getUsers(req, res);

    }
    catch (err) {

        await client.query("ROLLBACK");

        console.error(err);

        return res
            .status(500)
            .send("Unable to save user permissions");

    }
    finally {

        client.release();

    }

};


exports.getCompanies =
    async (req, res) => {

        try {

            const result =
                await db.query(
                    `
                    SELECT
                        c.id,
                        c.name,
                        co.name AS country_name,
                        c.base_currency,
                        c.gst_registered,
                        c.max_users,
                        c.status
                    FROM companies c
                    LEFT JOIN countries co
                        ON co.id = c.country_id
                    ORDER BY c.name
                    `
                );

            const companies =
                result.rows;

            const viewData = {

                companies,

                permissions:
                    req.session.user
                        .permissions || [],

                updatedId:
                    req.session.updatedId
            };

            delete req.session.updatedId;

            if (
                req.headers['hx-request']
            ) {

                return res.render(
                    'pages/settings/companies',
                    {
                        ...viewData,
                        layout: false
                    }
                );

            }

            res.render(
                'pages/settings/companies',
                {
                    title: 'Companies',
                    activePage:
                        'Companies',

                    user:
                        req.session.user,

                    ...viewData
                }
            );

        } catch (err) {

            console.error(err);

            res.status(500)
                .send(
                    'Error loading companies'
                );

        }

};

exports.getAddCompany =
    async (req, res) => {

        try {

            const countries =
                await db.query(`
                    SELECT
                        id,
                        name
                    FROM countries
                    ORDER BY name
                `);

            const currencies =
                await db.query(`
                    SELECT
                        code,
                        name
                    FROM currencies
                    ORDER BY code
                `);

            res.render(
                'partials/company-form',
                {
                    layout: false,

                    isEdit: false,

                    company: {},

                    countries:
                        countries.rows,

                    currencies:
                        currencies.rows
                }
            );

        } catch (err) {

            console.error(err);

            res.status(500)
                .send(
                    'Unable to load company form'
                );

        }

    };

exports.postAddCompany =
    async (req, res) => {

        try {

            const {
                name,
                country_id,
                base_currency,
                status,
                max_users,
                financial_year_start,
                gst_number
            } = req.body;

            const gst_registered =
                req.body.gst_registered === 'on';

            //=================================
            // Validation
            //=================================

            if (
                !name ||
                !country_id ||
                !base_currency ||
                !status
            ) {

                return res
                    .status(400)
                    .send(
                        'Please fill all required fields.'
                    );

            }

            if (
                gst_registered &&
                !gst_number?.trim()
            ) {

                return res
                    .status(400)
                    .send(
                        'GST Number is required.'
                    );

            }

            //=================================
            // Duplicate Name Check
            //=================================

            const duplicate =
                await db.query(
                    `
                    SELECT id
                    FROM companies
                    WHERE LOWER(name) = LOWER($1)
                    AND country_id = $2
                    `,
                    [name, country_id]
                );

            if (
                duplicate.rows.length > 0
            ) {

                return res
                    .status(400)
                    .send(
                        'Company already exists.'
                    );

            }

            //=================================
            // Insert
            //=================================

            const result =
                await db.query(
                    `
                    INSERT INTO companies
                    (
                        name,
                        country_id,
                        base_currency,
                        status,
                        max_users,
                        financial_year_start,
                        gst_registered,
                        gst_number
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $7,
                        $8
                    )
                    RETURNING id
                    `,
                    [
                        name.trim(),
                        country_id,
                        base_currency,
                        status,
                        max_users || 5,
                        financial_year_start || null,
                        gst_registered,
                        gst_registered
                            ? gst_number.trim()
                            : null
                    ]
                );

            req.session.updatedId =
                result.rows[0].id;

            return exports.getCompanies(
                req,
                res
            );

        } catch (err) {

            if (
                err.constraint ===
                'ux_companies_country_name'
            ) {

                return res
                    .status(400)
                    .send(
                        'Company already exists in this country.'
                    );

            }

            if (
                err.constraint ===
                'ux_companies_country_gst'
            ) {

                return res
                    .status(400)
                    .send(
                        'GST number already exists in this country.'
                    );

            }

            console.error(err);

            return res
                .status(500)
                .send(
                    'Error creating company.'
                );

        }

    };

exports.getEditCompany =
    async (req, res) => {

        try {

            const { id } =
                req.params;

            const companyResult =
                await db.query(
                    `
                    SELECT
                        id,
                        name,
                        gst_registered,
                        gst_number,
                        TO_CHAR(financial_year_start,'YYYY-MM-DD') AS financial_year_start,
                        country_id,
                        base_currency,
                        status,
                        max_users
                    FROM companies
                    WHERE id = $1
                    `,
                    [id]
                );

            if (
                companyResult.rows.length === 0
            ) {

                return res
                    .status(404)
                    .send(
                        'Company not found.'
                    );

            }

            const countriesResult =
                await db.query(
                    `
                    SELECT
                        id,
                        name
                    FROM countries
                    ORDER BY name
                    `
                );

            const currenciesResult =
                await db.query(
                    `
                    SELECT
                        code,
                        name
                    FROM currencies
                    ORDER BY code
                    `
                );

            return res.render(
                'partials/company-form',
                {
                    layout: false,

                    isEdit: true,

                    company:
                        companyResult.rows[0],

                    countries:
                        countriesResult.rows,

                    currencies:
                        currenciesResult.rows
                }
            );

        } catch (err) {

            console.error(err);

            return res
                .status(500)
                .send(
                    'Error loading company.'
                );

        }

    };

exports.postEditCompany =
    async (req, res) => {

        try {

            const { id } =
                req.params;

            const {
                name,
                country_id,
                base_currency,
                status,
                max_users,
                financial_year_start,
                gst_number
            } = req.body;

            const gst_registered =
                req.body.gst_registered ===
                'on';


            //console.log("gst_registered:", gst_registered)
            //=========================
            // Validation
            //=========================

            if (
                !name ||
                !country_id ||
                !base_currency ||
                !status
            ) {

                return res
                    .status(400)
                    .send(
                        'Please fill all required fields.'
                    );

            }

            if (
                gst_registered &&
                !gst_number?.trim()
            ) {

                return res
                    .status(400)
                    .send(
                        'GST Number is required.'
                    );

            }

            //=========================
            // Duplicate Name Check
            //=========================

            const duplicateName =
                await db.query(
                    `
                    SELECT id
                    FROM companies
                    WHERE lower(name)
                        = lower($1)
                    AND country_id = $2
                    AND id <> $3
                    `,
                    [
                        name,
                        country_id,
                        id
                    ]
                );

            if (
                duplicateName.rows.length >
                0
            ) {

                return res
                    .status(400)
                    .send(
                        'Company already exists in this country.'
                    );

            }

            //=========================
            // Duplicate GST Check
            //=========================

            if (
                gst_registered &&
                gst_number
            ) {

                const duplicateGST =
                    await db.query(
                        `
                        SELECT id
                        FROM companies
                        WHERE gst_number = $1
                        AND country_id = $2
                        AND id <> $3
                        `,
                        [
                            gst_number,
                            country_id,
                            id
                        ]
                    );

                if (
                    duplicateGST.rows
                        .length > 0
                ) {

                    return res
                        .status(400)
                        .send(
                            'GST Number already exists in this country.'
                        );

                }

            }

            //=========================
            // Update
            //=========================

            await db.query(
                `
                UPDATE companies
                SET
                    name = $1,
                    country_id = $2,
                    base_currency = $3,
                    status = $4,
                    max_users = $5,
                    financial_year_start = $6,
                    gst_registered = $7,
                    gst_number = $8,
                    updated_at = NOW()
                WHERE id = $9
                `,
                [
                    name.trim(),
                    country_id,
                    base_currency,
                    status,
                    max_users || 5,
                    financial_year_start ||
                    null,
                    gst_registered,
                    gst_registered
                        ? gst_number.trim()
                        : null,
                    id
                ]
            );

            req.session.updatedId =
                id;

            return exports.getCompanies(
                req,
                res
            );

        } catch (err) {

            if (
                err.constraint ===
                'ux_companies_country_name'
            ) {

                return res
                    .status(400)
                    .send(
                        'Company already exists in this country.'
                    );

            }

            if (
                err.constraint ===
                'ux_companies_country_gst'
            ) {

                return res
                    .status(400)
                    .send(
                        'GST Number already exists in this country.'
                    );

            }

            console.error(err);

            return res
                .status(500)
                .send(
                    'Error updating company.'
                );

        }

    };


//Company->Users
exports.getCompanyUsers =
    async (req, res) => {

        try {

            const { id } =
                req.params;

            const companyResult =
                await db.query(
                    `
                    SELECT
                        id,
                        name
                    FROM companies
                    WHERE id = $1
                    `,
                    [id]
                );

            if (
                companyResult.rows.length === 0
            ) {

                return res
                    .status(404)
                    .send(
                        'Company not found.'
                    );

            }

            const usersResult =
                await db.query(
                    `
                    SELECT
                        u.id,
                        u.name,
                        u.email,
                        u.is_active,
                        r.role_name
                    FROM users u
                    LEFT JOIN roles r
                        ON r.id = u.role_id
                    WHERE u.company_id = $1
                    ORDER BY u.name
                    `,
                    [id]
                );

            const viewData = {

                company:
                    companyResult.rows[0],

                users:
                    usersResult.rows,

                permissions:
                    req.session.user
                        .permissions || [],

                updatedId:
                    req.session.updatedId
            };

            delete req.session.updatedId;

            if (req.headers['hx-request']) {

                return res.render(
                    'pages/settings/company-users',
                    {
                        layout: false,
                        ...viewData
                    }
                );

            }

            return res.render(
                'pages/settings/company-users',
                {
                    title: 'Company Users',
                    activePage: 'Settings',
                    ...viewData
                }
            );

        } catch (err) {

            console.error(err);

            return res
                .status(500)
                .send(
                    'Error loading users.'
                );

        }

    };

//Permissions
exports.getRolePermissions = async (req, res) => {

    try {

        const result = await db.query(
            `
            SELECT
                id,
                role_name,
                role_code,
                is_system
            FROM roles
            ORDER BY role_name
            `
        );

        const updatedId =
            req.session.updatedId;

        delete req.session.updatedId;

        const viewData = {

            roles:
                result.rows,

            updatedId,

            permissions:
                req.session.user.permissions
        };

        if (
            req.headers['hx-request']
        ) {

            return res.render(
                'pages/settings/permissions',
                {
                    layout: false,
                    ...viewData
                }
            );

        }

        return res.render(
            'pages/settings/permissions',
            {
                title: 'Permissions',
                activePage: 'Permissions',
                user: req.session.user,
                ...viewData
            }
        );

    } catch (err) {

        console.error(err);

        return res
            .status(500)
            .send(
                'Error loading permissions.'
            );

    }

};

exports.getEditRolePermissions = async (req, res) => {

    try {

        const signedInUser = req.session.user;
        //const canManageDelegation = req.session.user.role_scope === 'platform'; 
        const canManageDelegation = signedInUser.permissions.includes('permissions.manage');

        //const userRoleScope = signedInUser.role_scope;

        //console.log("userRoleScope:", userRoleScope);

        const { id } =
            req.params;

        const roleResult =
            await db.query(
                `
                SELECT
                    id,
                    role_name,
                    role_code,
                    is_system,
                    role_scope
                FROM roles
                WHERE id = $1
                `,
                [id]
            );

        if (
            roleResult.rows.length === 0
        ) {

            return res
                .status(404)
                .send(
                    'Role not found.'
                );

        };

        const role =
            roleResult.rows[0];

        const allowedScopes =
            role.role_scope === 'platform'
            ? ['platform', 'both']
            : ['company', 'both'];

        const permissionsResult =
            await db.query(
                `
                SELECT
                    p.id,
                    p.permission_code,
                    p.permission_name,
                    SPLIT_PART(p.permission_name, ' ', 1) AS action_name,
                    p.module_name,
                    p.delegation_scope,

                    CASE
                        WHEN rp.role_id IS NULL
                        THEN false
                        ELSE true
                    END AS assigned

                FROM permissions p

                LEFT JOIN role_permissions rp
                    ON rp.permission_id = p.id
                   AND rp.role_id = $1

                WHERE p.delegation_scope = ANY($2)

                ORDER BY
                    p.module_name,
                    CASE split_part(p.permission_name, ' ', 1)
                        WHEN 'View' THEN 1
                        WHEN 'Create' THEN 2
                        WHEN 'Edit' THEN 3
                        WHEN 'Delete' THEN 4
                        ELSE 99
                    END,
                    p.permission_name;`,
                [id, allowedScopes]
            );

        const permissions =
            permissionsResult.rows;

        //console.log(permissions);

        const groupedPermissions =
            permissions.reduce(
                (
                    groups,
                    permission
                ) => {

                    if (
                        !groups[
                        permission.module_name
                        ]
                    ) {

                        groups[
                            permission.module_name
                        ] = [];

                    }

                    groups[
                        permission.module_name
                    ].push(
                        permission
                    );

                    return groups;

                },
                {}
            );

        //console.log("canManageDelegation:", canManageDelegation);

        //=========================================
        if (
            req.headers['hx-request']
        ) {

            return res.render(
                'pages/settings/role-permissions',
                {
                    layout: false,
                    role,
                    groupedPermissions,
                    canManageDelegation
                }
            );

        }

        return res.render(
            'pages/settings/role-permissions',
            {
                title: 'Role-Permissions',
                activePage: 'Permissions',
                role,
                groupedPermissions
            }
        );
        //=========================================


    } catch (err) {

        console.error(err);

        return res
            .status(500)
            .send(
                'Error loading permissions.'
            );

    }

};

exports.postEditRolePermissions = async (req, res) => {

    const client = await db.connect();

    try {

        await client.query("BEGIN");

        const roleId = req.params.id;

        //====================================================
        // Selected Permissions
        //====================================================

        const selectedPermissions = new Set(
            [].concat(req.body.permissions || []).map(Number)
        );

        //====================================================
        // Get Role Scope
        //====================================================

        const roleResult = await client.query(
            `
            SELECT role_scope
            FROM roles
            WHERE id = $1
            `,
            [roleId]
        );

        if (roleResult.rows.length === 0) {

            throw new Error("Role not found");

        }

        const allowedScopes =
            roleResult.rows[0].role_scope === 'platform'
                ? ['platform', 'both']
                : ['company', 'both'];

        //====================================================
        // Validate Submitted Permissions
        //====================================================

        const validPermissionResult =
            await client.query(
                `
                SELECT id
                FROM permissions
                WHERE delegation_scope = ANY($1)
                `,
                [allowedScopes]
            );

        const validPermissionSet = new Set(
            validPermissionResult.rows.map(
                p => Number(p.id)
            )
        );

        const values = [];

        for (const permissionId of selectedPermissions) {

            if (validPermissionSet.has(permissionId)) {

                values.push([
                    roleId,
                    permissionId
                ]);

            }

        }

        //====================================================
        // Replace Existing Role Permissions
        //====================================================

        await client.query(
            `
            DELETE
            FROM role_permissions
            WHERE role_id = $1
            `,
            [roleId]
        );

        //====================================================
        // Bulk Insert
        //====================================================

        if (values.length > 0) {

            const placeholders = values
                .map((_, i) => {

                    const p = i * 2;

                    return `($${p + 1}, $${p + 2})`;

                })
                .join(", ");

            const params = values.flat();

            await client.query(
                `
                INSERT INTO role_permissions
                (
                    role_id,
                    permission_id
                )
                VALUES
                ${placeholders}
                `,
                params
            );

        }

        await client.query("COMMIT");

        return this.getRoles(req, res);

    }
    catch (err) {

        await client.query("ROLLBACK");

        console.error(err);

        res.status(500).send("Unable to save role permissions");

    }
    finally {

        client.release();

    }

};

/* exports.postEditRolePermissions = async (req, res) => {

    const db = require('../config/db');

    const client = await db.connect();

    try {

        await client.query('BEGIN');

        const roleId =
            req.params.id;

        const permissions =
            req.body.permissions || [];

        const permissionIds =
            Array.isArray(permissions)
                ? permissions
                : [permissions];

        await client.query(
            `
            DELETE
            FROM role_permissions
            WHERE role_id = $1
            `,
            [roleId]
        );

        for (const permissionId of permissionIds) {

            await client.query(
                `
                INSERT INTO role_permissions
                (
                    role_id,
                    permission_id
                )
                VALUES
                (
                    $1,
                    $2
                )
                `,
                [
                    roleId,
                    permissionId
                ]
            );

        }

        //==== Saving delegation_scope ============//


        await client.query('COMMIT');

        req.session.updatedId =
            roleId;

        return exports.getRoles(
            req,
            res
        );

    } catch (err) {

        await client.query(
            'ROLLBACK'
        );

        console.error(err);

        return res
            .status(500)
            .send(
                'Error saving permissions.'
            );

    } finally {

        client.release();

    }

}; */