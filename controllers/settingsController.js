const db = require("../config/db");
const { getAccountEditContext } = require('../utils/accountHelper');



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

    console.log("Delete acc id:", id);

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
            SELECT e.*, f.name AS default_forwarder_name
            FROM entities e
            LEFT JOIN entities f
            ON e.default_forwarder_id = f.id
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