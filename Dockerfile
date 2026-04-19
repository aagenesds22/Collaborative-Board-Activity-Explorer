# Multi-stage Dockerfile for Mural Board Activity Explorer
#
# Stage 1: Build
# - Install dependencies
# - Compile TypeScript to JavaScript
# - Produces dist/ directory
#
# Stage 2: Runtime
# - Use minimal Node.js image
# - Copy compiled application and seed data
# - Run on port 3000
#
# This approach minimizes final image size by excluding dev dependencies

FROM node:20-alpine AS builder

WORKDIR /build

# Copy configuration files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for build)
# Use npm install to generate package-lock.json if it doesn't exist
RUN npm install

# Copy source code
COPY src ./src

# Compile TypeScript to JavaScript
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Copy only production dependencies (no devDependencies)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled application from builder stage
COPY --from=builder /build/dist ./dist

# Copy seed data
COPY seed-data.jsonl ./

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/notes', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})" || exit 1

# Expose port 3000
EXPOSE 3000

# Run application
CMD ["node", "dist/main.js"]
