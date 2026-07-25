#!/bin/bash
# Run this once on the server before starting the bot
# ./setup.sh

if [ -f .env ]; then
  echo ".env already exists. Remove it first if you want to re-run setup."
  exit 1
fi

echo "=== Mkitty Bot Setup ==="
echo "You need your Discord Bot Token and Client ID."
echo "Get them from https://discord.com/developers/applications"
echo ""

read -p "Discord Bot Token: " token
read -p "Discord Client ID: " client_id

cat > .env <<EOF
DISCORD_TOKEN=$token
DISCORD_CLIENT_ID=$client_id
EOF

echo ""
echo ".env created. Now run: docker compose up -d"
echo "Then type !setup in Discord to configure the rest."
