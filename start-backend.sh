#!/bin/bash

# OSI Dashboard Backend Startup Script with PM2
echo "🚀 Starting OSI Dashboard Backend..."

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if we're in the server directory
if [ ! -f "package.json" ]; then
    print_error "Not in server directory! Run this from /server folder"
    exit 1
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    print_error ".env file missing in server folder"
    print_status "Creating .env from .env.example..."
    
    if [ -f ".env.example" ]; then
        cp .env.example .env
        print_warning "Created .env file from template"
        print_warning "IMPORTANT: Edit .env file with your actual configuration before running again!"
        print_status ""
        print_status "Required environment variables to configure:"
        echo "  - MONGODB_URI (MongoDB connection string)"
        echo "  - JWT_SECRET (Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")"
        echo "  - REFRESH_TOKEN_SECRET (Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")"
        echo "  - SESSION_SECRET (Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")"
        echo "  - ENCRYPTION_KEY (Generate with: node -e \"console.log(require('crypto').randomBytes(16).toString('hex'))\")"
        echo "  - AZURE_CLIENT_ID (From Azure Portal)"
        echo "  - AZURE_CLIENT_SECRET (From Azure Portal)"
        echo "  - AZURE_TENANT_ID (From Azure Portal)"
        echo "  - AZURE_REDIRECT_URI (Update with your domain)"
        echo "  - FRONTEND_URL (Update with your frontend domain for production)"
        echo ""
        print_status "For production, also update:"
        echo "  - NODE_ENV=production"
        echo "  - PORT=4000 (or your preferred port)"
        exit 1
    else
        print_error ".env.example not found. Please create .env manually"
        exit 1
    fi
fi

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    print_error "PM2 is not installed!"
    print_status "Install PM2 globally with:"
    echo "  npm install -g pm2"
    exit 1
fi

print_status "Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    print_error "Failed to install dependencies"
    exit 1
fi

print_status "Building TypeScript..."
npm run build

if [ $? -ne 0 ]; then
    print_error "Failed to build TypeScript"
    exit 1
fi

print_status "Starting backend server with PM2..."
# Kill any existing process
pm2 delete osi-dashboard-backend 2>/dev/null || true

# Start the backend with PM2
pm2 start dist/index.js --name "osi-dashboard-backend"

if [ $? -ne 0 ]; then
    print_error "Failed to start server with PM2"
    exit 1
fi

# Save PM2 process list
pm2 save

print_status "✅ Backend started successfully!"
print_status ""
print_status "Backend API running on port 4000 (or your configured PORT)"
print_status ""
print_status "Useful PM2 commands:"
echo "  pm2 status                       # Check status"
echo "  pm2 logs osi-dashboard-backend   # View logs"
echo "  pm2 logs --lines 100             # View last 100 lines"
echo "  pm2 restart osi-dashboard-backend # Restart"
echo "  pm2 stop osi-dashboard-backend    # Stop"
echo "  pm2 delete osi-dashboard-backend  # Remove"
echo "  pm2 monit                        # Monitor resources"
echo ""
print_status "Test the API:"
echo "  curl http://localhost:4000/api-dashboard/health"
echo ""
print_status "To make PM2 start on system reboot:"
echo "  pm2 startup"
echo "  # Then run the command it outputs"
