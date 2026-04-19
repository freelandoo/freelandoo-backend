const { S3Client } = require("@aws-sdk/client-s3");
const { createLogger } = require("../utils/logger");

const log = createLogger("r2Client");

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

log.info("s3_client.configured", {
  hasEndpoint: !!process.env.R2_ENDPOINT,
  hasBucket: !!process.env.R2_BUCKET_NAME,
});

module.exports = r2;
