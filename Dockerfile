FROM node:20-bullseye

# 1. Install Aplikasi Pendukung (FFmpeg, ImageMagick, LibreOffice, dll)
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    imagemagick \
    webp \
    libreoffice \
    poppler-utils \
    python3 \
    python3-pip \
    zbar-tools \
    iputils-ping && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 2. Install Downloader Tools
RUN pip3 install yt-dlp gallery-dl speedtest-cli

# 3. Setup Folder Kerja
WORKDIR /usr/src/app

# 4. Copy Package & Install Modules
COPY package.json .
# --- HAPUS package-lock JIKA ADA BIAR GAK KONFLIK ---
RUN rm -f package-lock.json 
RUN npm install

# 5. 🔥 JURUS PAKSA: DOWNGRADE JIMP MANUAL 🔥
# Ini akan menimpa instalasi Jimp apapun jadi versi 0.16.13
RUN npm uninstall jimp && npm install jimp@0.16.13

# 6. Copy Script Bot
COPY . .

# 7. Buka Port
EXPOSE 8080

# 8. Jalankan Bot
CMD ["node", "index.js"]