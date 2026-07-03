//== getAllowedScopes ===========================//
function getAllowedScopes(roleScope) {

    switch (roleScope) {

        case 'platform':
            return ['platform', 'both'];

        case 'company':
            return ['company', 'both'];

        default:
            throw new Error(
                `Unknown role scope: ${roleScope}`
            );

    }

}


//== getRolePermissions ===========================//
async function getRolePermissions(client, roleId, allowedScopes) {
    const rolePermissionResult =
        await client.query(
            `
                SELECT rp.permission_id

                FROM role_permissions rp

                JOIN permissions p
                    ON p.id = rp.permission_id

                WHERE rp.role_id = $1
                  AND p.delegation_scope = ANY($2)
                `,
            [
                roleId,
                allowedScopes
            ]
        );

    const rolePermissions = new Set(
        rolePermissionResult.rows.map(r =>
            Number(r.permission_id)
        )
    );

    return rolePermissions;

};


//== getValidPermissions ===========================//
async function getValidPermissions(client, allowedScopes) {

    const result = await client.query(
        `
        SELECT id
        FROM permissions
        WHERE delegation_scope = ANY($1)
        `,
        [allowedScopes]
    );

    return new Set(
        result.rows.map(r => Number(r.id))
    );

}


module.exports = {
    getAllowedScopes,
    getRolePermissions,
    getValidPermissions
};