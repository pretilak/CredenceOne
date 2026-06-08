CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    company_id BIGINT REFERENCES companies(id),
    role VARCHAR(50) NOT NULL,  -- superuser, admin, accountant, viewer
    is_active BOOLEAN DEFAULT TRUE,
    is_2fa_enabled BOOLEAN DEFAULT FALSE,
    twofa_secret TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);