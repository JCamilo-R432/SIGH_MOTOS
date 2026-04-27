# syntax=docker/dockerfile:1

# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

# Instalar dependencias de sistema necesarias para compilación nativa y Prisma
RUN apt-get update && apt-get install -y openssl ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copiar solo package.json y lock para instalar dependencias limpias
COPY package*.json ./

# Instalar dependencias SIN ejecutar scripts (evita errores tempranos por permisos)
RUN npm ci --ignore-scripts

# COPIAR TODO EL CÓDIGO FUENTE (INCLUYENDO prisma/schema.prisma)
COPY . .

# FORZAR LA REINSTALACIÓN DE PRISMA PARA GARANTIZAR BINARIOS NATIVOS DE LINUX
RUN rm -rf node_modules/@prisma/client node_modules/prisma
RUN npm install @prisma/client prisma --save-dev

# AHORA SÍ: Generar cliente de Prisma
RUN npx prisma generate

# FORZAR PERMISOS DE EJECUCIÓN EN TODOS LOS BINARIOS DE NODE.JS (INCLUIDO tsc)
RUN chmod -R +x node_modules/.bin/

# COMPILAR TYPESCRIPT A JAVASCRIPT
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Prisma query engine requires OpenSSL on Alpine
RUN apk add --no-cache openssl

# Crear usuario no-root por seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copiar solo lo necesario desde la etapa de build
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./

# Cambiar propietario de archivos
RUN chown -R nextjs:nodejs /app

# Usar usuario no-root
USER nextjs

EXPOSE 3000

CMD ["node", "dist/server.js"]