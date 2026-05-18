const express = require("express");
const CountryController = require("../controllers/CountryController");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(CountryController.list));

module.exports = router;
