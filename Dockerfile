FROM node:20-bullseye

# 1. Install Pisau Dapur (ImageMagick & FFmpeg)
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    imagemagick \
    webp && \
    rm -rf /var/lib/apt/lists/*

# 2. Trik Sulap 1: Ubah nama 'convert' jadi 'magick'
RUN ln -s /usr/bin/convert /usr/bin/magick

# 3. Trik Sulap 2: Jebol Security Policy ImageMagick (Biar fitur Brat jalan)
# Kita izinkan ImageMagick baca file teks pakai simbol @
RUN sed -i 's/rights="none" pattern="@\*"/rights="read|write" pattern="@*"/' /etc/ImageMagick-6/policy.xml

# 4. Siapkan Folder
WORKDIR /usr/src/app

# 5. Copy & Install
COPY package*.json ./
RUN npm install

# 6. Masukkan sisa file
COPY . .

# 7. Jalankan
CMD ["node", "index.js"]