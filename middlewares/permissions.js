function requirePermission(permission) {

    return (req, res, next) => {

        if (!req.session.user) {

            return res.redirect('/login');
        }

        const permissions =
            req.session.user.permissions || [];

//console.log("permission:", permission, " Permissions:", permissions);

        if (!permissions.includes(permission)) {

            // =========================================
            // HTMX request
            // =========================================

            if (req.headers['hx-request']) {

                //res.set('HX-Trigger', 'permissionDenied');

                return res
                    .status(403)
                    .send(`
            <div class="error-container">
                Forbidden
            </div>
        `);
            }
            // =========================================
            // Normal request
            // =========================================

            return res
                .status(403)
                .send('Forbidden');
        }

        next();
    };
}

module.exports = requirePermission;
