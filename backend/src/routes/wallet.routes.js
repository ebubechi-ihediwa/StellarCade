const express = require('express');
const { deposit, withdraw } = require('../controllers/wallet.controller');
const auth = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/deposit', auth, deposit);
router.post('/withdraw', auth, withdraw);

module.exports = router;
