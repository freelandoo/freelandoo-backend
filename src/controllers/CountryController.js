const pool = require("../databases");
const CountryService = require("../services/CountryService");

class CountryController {
  static async list(req, res) {
    const countries = await CountryService.listActive({ db: pool });
    return res.json(countries);
  }
}

module.exports = CountryController;
