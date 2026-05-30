// configure-r2-stories.js
//
// Configura o bucket R2 para o módulo de câmera (upload direto do browser):
//   1) CORS — permite PUT/GET/HEAD a partir dos domínios da Freelandoo.
//   2) Lifecycle — expira objetos sob "stories/" após 1 dia (stories duram 24h).
//
// Rodar UMA VEZ, com as envs do R2 carregadas:
//   node configure-r2-stories.js
//
// Requer no ambiente: R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
require("dotenv").config();
const {
  S3Client,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
} = require("@aws-sdk/client-s3");

const ALLOWED_ORIGINS = [
  "https://freelandoo.com.br",
  "https://www.freelandoo.com.br",
  "https://*.vercel.app", // preview + prod deploys da Vercel
  "http://localhost:3000",
];

async function main() {
  const Bucket = process.env.R2_BUCKET_NAME;
  if (!Bucket || !process.env.R2_ENDPOINT) {
    throw new Error("Faltam R2_BUCKET_NAME / R2_ENDPOINT no ambiente.");
  }
  const r2 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  // NOTA: o CORS abaixo cobre o bucket inteiro. Se já houver regras de CORS,
  // ajuste para mesclar em vez de sobrescrever.
  await r2.send(
    new PutBucketCorsCommand({
      Bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedMethods: ["PUT", "GET", "HEAD"],
            AllowedOrigins: ALLOWED_ORIGINS,
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    })
  );
  console.log("[ok] CORS aplicado:", ALLOWED_ORIGINS.join(", "));

  await r2.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: "expire-stories-24h",
            Status: "Enabled",
            Filter: { Prefix: "stories/" },
            Expiration: { Days: 1 },
          },
        ],
      },
    })
  );
  console.log("[ok] Lifecycle aplicado: objetos sob 'stories/' expiram em 1 dia.");
}

main().catch((err) => {
  console.error("[erro]", err?.message || err);
  process.exit(1);
});
