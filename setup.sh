#!/bin/bash
# Run this once on the server before starting the bot
# ./setup.sh

if [ -f .env ]; then
  echo ".env already exists. Remove it first if you want to re-run setup."
  exit 1
fi

echo "=== Mkitty Bot Setup ==="
echo ""

read -p "Discord Bot Token: " token
read -p "Discord Client ID: " client_id
read -p "Dashboard Password (for web UI): " admin_pw
read -p "Web Port [3000]: " port
port=${port:-3000}

cat > .env <<EOF
DISCORD_TOKEN=$token
DISCORD_CLIENT_ID=$client_id
ADMIN_PASSWORD=$admin_pw
WEB_PORT=$port
EOF

echo ""
echo ".env created. Now run: docker compose up -d"
echo "Then open http://YOUR_SERVER_IP:$port in your browser."
