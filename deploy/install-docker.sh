#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive

echo "==> Updating apt..."
apt-get update -y -qq

echo "==> Installing prerequisites..."
apt-get install -y -qq ca-certificates curl gnupg

echo "==> Adding Docker GPG key..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "==> Adding Docker repo..."
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list

echo "==> Updating apt with Docker repo..."
apt-get update -y -qq

echo "==> Installing Docker..."
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "==> Starting Docker..."
systemctl enable docker
systemctl start docker

echo "==> Done!"
docker --version
docker compose version
