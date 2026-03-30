#!/bin/bash
# Combined startup script for Flask Simulator + AWS IoT Publisher

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting ADAS Simulator + AWS IoT Integration...${NC}"
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo -e "${GREEN}[0/3] Creating Python virtual environment...${NC}"
    python3 -m venv venv
    source venv/bin/activate
    echo -e "${GREEN}[0/3] Installing Python dependencies...${NC}"
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

# Start Flask simulator in background
echo -e "${GREEN}[1/3] Starting Flask ADAS Simulator (http://localhost:5000)...${NC}"
python3 simulator.py &
FLASK_PID=$!
sleep 2

# Install Node dependencies
echo -e "${GREEN}[2/3] Installing Node.js dependencies...${NC}"
cd simulator
npm install > /dev/null 2>&1

# Start AWS IoT Publisher
echo -e "${GREEN}[3/3] Starting AWS IoT Telemetry Publisher...${NC}"
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}✅ Both services are running!${NC}"
echo -e "${BLUE}📊 Dashboard: http://localhost:5000${NC}"
echo -e "${BLUE}📡 Publishing to AWS IoT Core (vehicle/*/telemetry)${NC}"
echo -e "${BLUE}${NC}"
echo "Press Ctrl+C to stop all services..."
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

npm start

# Cleanup on exit
trap "kill $FLASK_PID" EXIT
