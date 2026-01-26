FROM node:18-buster

# Install alat-alat dapur (ImageMagick & FFmpeg)
RUN apt-get update && \
  apt-get install -y \
  ffmpeg \
  imagemagick \
  webp && \
  apt-get upgrade -y && \
  rm -rf /var/lib/apt/lists/*

# Siapkan folder kerja
WORKDIR /usr/src/app

# Copy file package.json biar bisa install npm
COPY package*.json ./

# Install paket npm
RUN npm install

# Copy semua file bot kamu ke dalam server
COPY . .

# Jalankan bot
CMD ["node", "index.js"]