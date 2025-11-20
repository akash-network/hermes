# Akash Hermes Oracle Client

Automatic price feed updater for Akash Network oracle contracts using Pyth Network's Hermes API.

## 📁 Project Structure

```
hermes-client/
├── src/
│   ├── hermes-client.ts       # Main client implementation
│   └── cli.ts                 # CLI tool
├── package.json               # Node.js dependencies
├── tsconfig.json              # TypeScript configuration
├── .env.example               # Environment variables template
├── Dockerfile                 # Docker image
├── docker-compose.yml         # Docker Compose setup
├── hermes-client.service      # Systemd service file
└── README.md                  # This file
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```bash
RPC_ENDPOINT=https://rpc.akashnet.net:443
CONTRACT_ADDRESS=akash1your_contract_address
MNEMONIC="your twelve or twenty four word mnemonic"
```

### 3. Run

```bash
# Build TypeScript
npm run build

# Run one-time update
npm run cli:update

# Query current price
npm run cli:query

# Start daemon (continuous updates)
npm run cli:daemon
```

## 📋 Available Commands

### NPM Scripts

```bash
npm run build          # Compile TypeScript to JavaScript
npm run start          # Start the client daemon
npm run dev            # Run in development mode
npm run cli            # Run CLI tool
npm run cli:update     # Update price once
npm run cli:query      # Query current price
npm run cli:status     # Show client status
npm run cli:daemon     # Run continuous updates
```

### CLI Usage

```bash
# After building
node dist/cli.js update    # Update price once
node dist/cli.js query     # Query current price
node dist/cli.js status    # Show status
node dist/cli.js daemon    # Run daemon
```

## 🐳 Docker Deployment

### Option 1: Docker Compose (Recommended)

```bash
# Configure .env first
cp .env.example .env
# Edit .env with your settings

# Start
docker-compose up -d

# View logs
docker-compose logs -f hermes-client

# Stop
docker-compose down
```

### Option 2: Docker Build & Run

```bash
# Build image
docker build -t akash-hermes-client .

# Run container
docker run -d \
  --name hermes-client \
  --env-file .env \
  --restart unless-stopped \
  akash-hermes-client

# View logs
docker logs -f hermes-client
```

## 🔄 Systemd Service (Linux Production)

```bash
# 1. Build project
npm run build

# 2. Copy to /opt
sudo mkdir -p /opt/hermes-client
sudo cp -r dist package.json .env /opt/hermes-client/
cd /opt/hermes-client
sudo npm ci --production

# 3. Install systemd service
sudo cp hermes-client.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable hermes-client
sudo systemctl start hermes-client

# 4. Check status
sudo systemctl status hermes-client
sudo journalctl -u hermes-client -f
```

## 📊 Monitoring

### Check Logs

```bash
# Docker Compose
docker-compose logs -f

# Docker
docker logs -f hermes-client

# Systemd
sudo journalctl -u hermes-client -f
```

### Query Contract

```bash
# Check current price
akash query wasm contract-state smart $CONTRACT_ADDRESS '{"get_price":{}}'

# Check configuration
akash query wasm contract-state smart $CONTRACT_ADDRESS '{"get_config":{}}'
```

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_ENDPOINT` | Yes | - | Akash RPC endpoint |
| `CONTRACT_ADDRESS` | Yes | - | Oracle contract address |
| `MNEMONIC` | Yes | - | Wallet mnemonic (12/24 words) |
| `HERMES_ENDPOINT` | No | `https://hermes.pyth.network` | Pyth Hermes API |
| `UPDATE_INTERVAL_MS` | No | `300000` | Update interval (5 min) |
| `GAS_PRICE` | No | `0.025uakt` | Gas price |
| `DENOM` | No | `uakt` | Token denomination |

### Update Frequency

Change update interval in `.env`:
```bash
UPDATE_INTERVAL_MS=300000   # 5 minutes (default)
UPDATE_INTERVAL_MS=180000   # 3 minutes
UPDATE_INTERVAL_MS=600000   # 10 minutes
```

## 💡 How It Works

### Workflow

```
1. Initialize client
   - Load configuration
   - Create wallet from mnemonic
   - Connect to Akash RPC
   - Query contract for price_feed_id
         ↓
2. Fetch price from Pyth Hermes
   GET https://hermes.pyth.network/v2/updates/price/latest?ids={price_feed_id}
         ↓
3. Query current price from contract
         ↓
4. Compare publish times
   - If new data → Update contract
   - If same/old → Skip update
         ↓
5. Wait for next interval
   - Repeat from step 2
```

### Smart Update Logic

The client only submits transactions when:
- ✅ New price data is available (newer publish_time)
- ✅ Wallet has sufficient balance
- ✅ Price passes validation (non-zero, reasonable confidence)

This minimizes transaction costs and blockchain load.

## 💰 Cost Estimation

### Per Update
```
Gas cost:   150,000 gas × 0.025 uakt/gas = 3,750 uakt
Update fee: 1,000 uakt (example, set in contract)
Total:      ~4,750 uakt per update
```

### Monthly Cost (5-minute updates)
```
Updates per day:    288
Updates per month:  8,640
Monthly cost:       8,640 × 4,750 uakt = 41.04 AKT
```

### Reduce Costs

Increase update interval to reduce costs:
```bash
UPDATE_INTERVAL_MS=600000   # 10 min → 50% cost savings
UPDATE_INTERVAL_MS=900000   # 15 min → 67% cost savings
```

## 🔒 Security

### Wallet Security

✅ **Use dedicated wallet** - Create separate wallet for oracle updates only  
✅ **Limit funding** - Only keep necessary AKT (monthly costs + buffer)  
✅ **Secure mnemonic** - Use environment variables or secrets manager  
✅ **Never commit .env** - Already in .gitignore  
✅ **Monitor activity** - Set up alerts for unusual transactions

### Best Practices

```bash
# DON'T: Store mnemonic in code
const mnemonic = "word1 word2 word3..."

# DO: Load from environment
const mnemonic = process.env.MNEMONIC

# BETTER: Use secrets manager (production)
const mnemonic = await secretsManager.getSecret("hermes-mnemonic")
```

## 🔧 Troubleshooting

### Common Issues

**"Client not initialized"**
```bash
# Solution: Ensure initialize() is called
await client.initialize()
```

**"Insufficient funds"**
```bash
# Check wallet balance
akash query bank balances <YOUR_ADDRESS>

# Fund wallet
akash tx bank send <FROM> <ORACLE_ADDRESS> 100000000uakt --gas auto
```

**"Failed to fetch from Hermes"**
```bash
# Test Hermes API
curl "https://hermes.pyth.network/v2/updates/price/latest?ids=<PRICE_FEED_ID>"

# Check price feed ID
akash query wasm contract-state smart $CONTRACT_ADDRESS '{"get_price_feed_id":{}}'
```

**"Price already up to date"**
- Not an error! Contract already has the latest price
- Client will try again on next interval

### Debug Mode

```bash
# Enable verbose logging
export DEBUG=*
npm run cli:daemon
```

### Test Connectivity

```bash
# Test RPC
curl $RPC_ENDPOINT/status

# Test Hermes
curl "https://hermes.pyth.network/api/latest_price_feeds?ids[]=<FEED_ID>"

# Test contract
akash query wasm contract-state smart $CONTRACT_ADDRESS '{"get_config":{}}'
```

## 📚 Documentation

For more detailed information:

- **Installation & Setup** - See this README
- **API Reference** - See `src/hermes-client.ts` JSDoc comments
- **CLI Reference** - Run `npm run cli -- --help`
- **Pyth Network** - https://docs.pyth.network/
- **Hermes API** - https://hermes.pyth.network/docs/

## 🆘 Support

- **Issues**: Open GitHub issue
- **Akash Discord**: https://discord.akash.network
- **Pyth Discord**: https://discord.gg/pythnetwork

## 📄 License

MIT License

---

**Ready to deploy!** 🚀

Start with: `npm install && cp .env.example .env`