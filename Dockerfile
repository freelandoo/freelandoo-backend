# Imagem enxuta — evita a etapa apt-get do builder padrão (railpack),
# que estava falhando intermitentemente na infra do Railway com
# "No space left on device" durante apt-get install libatomic1.
FROM node:22-slim

WORKDIR /app

# Instala deps primeiro pra aproveitar cache de layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copia o resto do projeto (respeitando .dockerignore).
COPY . .

ENV NODE_ENV=production

CMD ["npm", "start"]
