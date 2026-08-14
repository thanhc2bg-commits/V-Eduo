const express = require('express');
const router = express.Router();

const AuthController = require('../app/controllers/AuthController');
const { authLimiter } = require('../app/middlewares/rateLimit');

router.get('/register', AuthController.showRegister);

router.post('/register', authLimiter, AuthController.register);

router.get('/login', AuthController.showLogin);

router.post('/login', authLimiter, AuthController.login);

router.post('/logout', AuthController.logout);

router.post('/refresh', authLimiter, AuthController.refreshAccessToken);

module.exports = router;
