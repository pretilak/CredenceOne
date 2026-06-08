// utils/accountHelper.js
exports.getAccountEditContext = async (db, companyId, account = null) => {

  let isEdit = !!account;
  let isSystem = account?.is_system || false;
  let isUsed = false;

  if (account) {
    const usage = await db.query(`
      SELECT 1 FROM journal_lines
      WHERE account_id = $1 LIMIT 1
    `, [account.id]);

    isUsed = usage.rowCount > 0;
  }

  
  // Add/Edit account ============================

  // Fetch valid parents (same logic for add/edit)
  let parents = await db.query(`
    SELECT id, acc_name
    FROM accounts
    WHERE company_id = $1
      AND is_postable = false
      ${account ? 'AND id != $2 AND account_type = $3' : ''}
  `, account
      ? [companyId, account.id, account.account_type]
      : [companyId]
  );

  return {
    isEdit,
    isSystem,
    isUsed,
    canEditAll: !isSystem && !isUsed,
    canEditName: !isSystem,
    parents: parents.rows
  };
}