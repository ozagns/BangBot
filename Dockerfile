FROM node:20-bullseye

# Install aplikasi pendukung standar
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    imagemagick \
    webp \
    python3 \
    python3-pip \
    iputils-ping && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install tools python tanpa flag aneh-aneh
RUN pip3 install yt-dlp gallery-dl speedtest-cli

WORKDIR /usr/src/app

# Copy dan install standar
COPY package.json .
RUN npm install

# Copy sisa file
COPY . .

EXPOSE 8080
CMD ["node", "index.js"]