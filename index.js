require("dotenv").config();

const app = require("./src/app");
const { createLogger } = require("./src/utils/logger");

const bootLog = createLogger("boot");

// porta vinda do .env ou fallback
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  bootLog.info("server.listen", { port: PORT });
});
