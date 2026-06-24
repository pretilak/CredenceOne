const express = require("express");
const router = express.Router();

const requireAuth = require("../middlewares/requireAuth");
const requirePermission = require("../middlewares/permissions");

const settingsController = require("../controllers/settingsController");

//CoA
router.get('/settings/coa/parents', settingsController.getParentsByType);

router.get("/settings/coa", requireAuth, requirePermission('coa.view'),settingsController.getCoa);

router.get('/settings/coa/add', requireAuth, settingsController.getAddAccount);
router.get('/settings/coa/next-code', requireAuth, settingsController.getNextCode);

router.post('/settings/coa', requireAuth, requirePermission('coa.create'), settingsController.createAccount);

router.get('/settings/coa/:id/edit', requireAuth, settingsController.getEditAccount);
router.post('/settings/coa/:id', requireAuth, settingsController.updateAccount);

router.delete('/settings/coa/:id', requireAuth, settingsController.deleteAccount);

//Entities
router.get('/settings/entities', requireAuth, requirePermission('entities.view'), settingsController.getEntities);

router.get('/settings/entities/add', requireAuth, requirePermission('entities.create'), settingsController.getAddEntity);
router.post('/settings/entities', requireAuth, requirePermission('entities.create'), settingsController.createEntity);

router.get('/settings/entities/:id/edit', requireAuth, requirePermission('entities.edit'), settingsController.getEditEntity);
router.post('/settings/entities/:id', requireAuth, requirePermission('entities.edit'), settingsController.updateEntity);

router.delete('/settings/entities/:id', requireAuth, requirePermission('entities.delete'), settingsController.deleteEntity);

//Contacts
router.get('/settings/entities/:id/contacts', requireAuth, requirePermission('contacts.view'), settingsController.getEntityContacts);

router.get('/settings/entities/:entityId/contacts/add', requireAuth, requirePermission('contacts.create'), settingsController.getAddContact);
router.post('/settings/entities/:entityId/contacts', requireAuth, requirePermission('contacts.create'), settingsController.createContact);

router.get('/settings/contacts/:id/edit', requireAuth, requirePermission('contacts.edit'), settingsController.getEditContact);
router.post('/settings/contacts/:id', requireAuth, requirePermission('contacts.edit'),settingsController.updateContact);

router.delete('/settings/contacts/:id', requireAuth, requirePermission('contacts.delete'), settingsController.deleteContact);

//Roles
router.get('/settings/roles', requirePermission('roles.view'), settingsController.getRoles);

router.get('/settings/roles/add', requirePermission('roles.create'), settingsController.getAddRole);
router.post('/settings/roles', requirePermission('roles.create'), settingsController.createRole);

router.get('/settings/roles/:id/edit', requirePermission('roles.edit'), settingsController.getEditRole);
router.post('/settings/roles/:id', requirePermission('roles.edit'), settingsController.updateRole);

router.delete('/settings/roles/:id', requirePermission('roles.delete'), settingsController.deleteRole);

//Users
router.get('/settings/users', requirePermission('users.view'), settingsController.getUsers);

router.get('/settings/users/add', requirePermission('users.create'), settingsController.getAddUser);
router.post('/settings/users', requirePermission('users.create'), settingsController.createUser);

router.post('/settings/users/validate-email', requirePermission('users.edit'), settingsController.validateEmail);
router.get('/settings/users/:id/edit', requirePermission('users.edit'), settingsController.getEditUser);
router.post('/settings/users/:id', requirePermission('users.edit'), settingsController.updateUser);

//Companies
router.get('/settings/companies', requirePermission('companies.view'), settingsController.getCompanies);

router.get('/settings/companies/add', requirePermission('companies.create'), settingsController.getAddCompany);
router.post('/settings/companies', requirePermission('companies.create'), settingsController.postAddCompany);

router.get('/settings/companies/:id/edit', requirePermission('companies.edit'), settingsController.getEditCompany);
router.post('/settings/companies/:id', requirePermission('companies.edit'), settingsController.postEditCompany);

//Company->Users
router.get('/settings/companies/:id/users', requirePermission('users.view'), settingsController.getCompanyUsers);

module.exports = router;