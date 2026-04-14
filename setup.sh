#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Setting up nestjs-query-mikro-orm${NC}\n"

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}⚠️  pnpm is not installed. Installing pnpm...${NC}"
    npm install -g pnpm
fi

echo -e "${GREEN}✓ Installing dependencies...${NC}"
pnpm install

echo -e "${GREEN}✓ Setting up git hooks...${NC}"
pnpm prepare

echo -e "${GREEN}✓ Building the project...${NC}"
pnpm build

echo -e "\n${GREEN}✅ Setup complete!${NC}\n"
echo -e "${BLUE}Available commands:${NC}"
echo -e "  ${YELLOW}pnpm build${NC}         - Build the library"
echo -e "  ${YELLOW}pnpm dev${NC}           - Build in watch mode"
echo -e "  ${YELLOW}pnpm test${NC}          - Run tests"
echo -e "  ${YELLOW}pnpm test:watch${NC}    - Run tests in watch mode"
echo -e "  ${YELLOW}pnpm lint${NC}          - Lint code"
echo -e "  ${YELLOW}pnpm format${NC}        - Format code"
echo -e "  ${YELLOW}pnpm typecheck${NC}     - Type check code"
echo ""
