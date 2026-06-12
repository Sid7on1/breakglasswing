FROM node:20-alpine

# Install Chromium for Puppeteer Auth Automator
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Create non-root user for security
RUN addgroup -g 1001 breakglass && \
    adduser -u 1001 -G breakglass -s /bin/sh -D breakglass && \
    chown -R breakglass:breakglass /app

USER breakglass

# Start agent
CMD ["npm", "start"]
