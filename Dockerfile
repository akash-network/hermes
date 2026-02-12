# ====================
# Builder Stage
# ====================
FROM node:24.13.0-alpine AS builder

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./

# SEC-07: Use ci for reproducible builds from lockfile
RUN npm ci

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

FROM node:24.13.0-alpine

# Labels for container metadata
LABEL org.opencontainers.image.title="Akash Hermes Client"
LABEL org.opencontainers.image.description="Price relayer for Akash oracle using Pyth Network"
LABEL org.opencontainers.image.source="https://github.com/akash-network/hermes"
LABEL org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# SEC-07: Use ci for reproducible production builds from lockfile
RUN npm ci --omit=dev && \
    npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port (if needed for health checks)
EXPOSE 3000

# Health check against the healthcheck server
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENV NODE_OPTIONS="--no-network-family-autoselection --enable-source-maps --import ./dist/instrumentation.js"

# Start the daemon
CMD ["node", "dist/cli.js", "daemon"]
