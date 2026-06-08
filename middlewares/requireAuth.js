function requireAuth(req, res, next) {
    const user = req.session?.user;

    if (!user) {

        // ✅ HTMX request → force full redirect
        if (req.headers['hx-request']) {
            return res.set('HX-Redirect', `/login?redirect=${req.originalUrl}`).send();
        }

        // ✅ Normal request
        return res.redirect(`/login?redirect=${req.originalUrl}`);
    }

    next();
}

module.exports = requireAuth;