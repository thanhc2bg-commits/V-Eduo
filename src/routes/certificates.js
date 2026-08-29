const express = require('express');
const router = express.Router();

const CertificateController = require('../app/controllers/CertificateController');
const { certificateLimiter } = require('../app/middlewares/rateLimit');

// Trang chứng chỉ public — rate limit theo IP (chống scrape ID hàng loạt)
router.get('/:certificateId', certificateLimiter, CertificateController.show);

module.exports = router;
