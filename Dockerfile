FROM node:18-bullseye

# 1. Install Pisau Dapur (ImageMagick & FFmpeg)
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    imagemagick \
    webp && \
    rm -rf /var/lib/apt/lists/*

# 2. Trik Sulap: Ubah nama 'convert' jadi 'magick' biar bot gak bingung
RUN ln -s /usr/bin/convert /usr/bin/magick

# 3. Siapkan Folder
WORKDIR /usr/src/app

# 4. Copy & Install
COPY package*.json ./
RUN npm install

# 5. Masukkan sisa file
COPY . .

# 6. Jalankan
CMD ["node", "index.js"]