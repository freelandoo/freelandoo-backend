const { Router } = require("express");
const AddressController = require("../controllers/AddressController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get("/states", asyncHandler(AddressController.getEstados));

module.exports = router;
