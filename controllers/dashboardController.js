exports.getDashboard = async (req, res) => {

    if (req.headers['hx-request']) {
        // 👉 HTMX request → return ONLY content
        return res.render('pages/dashboard', {
            layout: false,
            user: req.session.user
        });
    }
    // 👉 Normal request → full layout
    res.render("pages/dashboard", {
        user: req.session.user,
        title: "Dashboard"
    });
}
