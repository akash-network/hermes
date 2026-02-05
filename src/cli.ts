#!/usr/bin/env node
/**
 * CLI tool for manual Hermes oracle updates
 *
 * Usage:
 *   npm run cli -- update                    # Update price once
 *   npm run cli -- query                     # Query current price
 *   npm run cli -- query --feed              # Query price feed with metadata
 *   npm run cli -- query --config            # Query contract configuration
 *   npm run cli -- query --oracle-params     # Query cached oracle parameters
 *   npm run cli -- status                    # Show contract status
 *   npm run cli -- daemon                    # Run continuous updates
 *   npm run cli -- admin refresh-params      # Refresh oracle params (admin)
 *   npm run cli -- admin update-fee <fee>    # Update fee (admin)
 *   npm run cli -- admin transfer <address>  # Transfer admin (admin)
 */

import HermesClient from './hermes-client';
import { program } from 'commander';
import {
    parsePositiveInt,
    validateMnemonic,
    validateBech32Address,
    validateUrl,
    validateFee,
} from './validation';
import { sanitizeError } from './errors';

interface CliConfig {
    rpc: string;
    contract: string;
    mnemonic: string;
    hermes?: string;
    interval?: number;
}

function loadConfig(): CliConfig {
    const config: CliConfig = {
        rpc: process.env.RPC_ENDPOINT || 'https://rpc.akashnet.net:443',
        contract: process.env.CONTRACT_ADDRESS || '',
        mnemonic: process.env.MNEMONIC || '',
        hermes: process.env.HERMES_ENDPOINT,
        interval: parsePositiveInt(process.env.UPDATE_INTERVAL_MS),
    };

    if (!config.contract) {
        console.error('Error: CONTRACT_ADDRESS environment variable is required');
        process.exit(1);
    }

    if (!config.mnemonic) {
        console.error('Error: MNEMONIC environment variable is required');
        process.exit(1);
    }

    // Validate inputs early with clear error messages
    validateUrl(config.rpc);
    validateBech32Address(config.contract);
    validateMnemonic(config.mnemonic);
    if (config.hermes) validateUrl(config.hermes);

    return config;
}

async function updateCommand() {
    console.log('📊 Updating oracle price...\n');

    const config = loadConfig();
    const client = new HermesClient({
        rpcEndpoint: config.rpc,
        contractAddress: config.contract,
        mnemonic: config.mnemonic,
        hermesEndpoint: config.hermes,
    });

    try {
        await client.initialize();
        await client.updatePrice();
        console.log('\n✅ Update completed successfully!');
    } catch (error) {
        console.error(`\n❌ Update failed: ${sanitizeError(error)}`);
        process.exit(1);
    }
}

interface QueryOptions {
    feed?: boolean;
    config?: boolean;
    oracleParams?: boolean;
}

async function queryCommand(options: QueryOptions) {
    const config = loadConfig();
    const client = new HermesClient({
        rpcEndpoint: config.rpc,
        contractAddress: config.contract,
        mnemonic: config.mnemonic,
    });

    try {
        await client.initialize();

        if (options.config) {
            console.log('🔧 Contract Configuration:\n');
            const cfg = await client.queryConfig();
            console.log('─────────────────────────────');
            console.log(`Admin:            ${cfg.admin}`);
            console.log(`Update Fee:       ${cfg.update_fee}`);
            console.log(`Price Feed ID:    ${cfg.price_feed_id}`);
            console.log(`Default Denom:    ${cfg.default_denom}`);
            console.log(`Base Denom:       ${cfg.default_base_denom}`);
            return;
        }

        if (options.oracleParams) {
            console.log('⚙️  Cached Oracle Parameters:\n');
            const params = await client.queryOracleParams();
            console.log('─────────────────────────────');
            console.log(`Max Deviation:    ${params.max_price_deviation_bps} bps (${params.max_price_deviation_bps / 100}%)`);
            console.log(`Min Sources:      ${params.min_price_sources}`);
            console.log(`Max Staleness:    ${params.max_price_staleness_blocks} blocks`);
            console.log(`TWAP Window:      ${params.twap_window} blocks`);
            console.log(`Last Updated:     Height ${params.last_updated_height}`);
            return;
        }

        if (options.feed) {
            console.log('📈 Price Feed Data:\n');
            const feed = await client.queryPriceFeed();
            console.log('─────────────────────────────');
            console.log(`Symbol:           ${feed.symbol}`);
            console.log(`Price:            ${feed.price}`);
            console.log(`Confidence:       ${feed.conf}`);
            console.log(`Exponent:         ${feed.expo}`);
            console.log(`Publish Time:     ${feed.publish_time}`);
            console.log(`                  ${new Date(feed.publish_time * 1000).toISOString()}`);
            console.log(`Prev Publish:     ${feed.prev_publish_time}`);
            console.log(`                  ${new Date(feed.prev_publish_time * 1000).toISOString()}`);

            // Calculate human-readable price
            const humanPrice = parseInt(feed.price) / Math.pow(10, Math.abs(feed.expo));
            const humanConf = parseInt(feed.conf) / Math.pow(10, Math.abs(feed.expo));
            console.log('\nFormatted:');
            console.log(`Price:            $${humanPrice.toFixed(8)} +/- $${humanConf.toFixed(8)}`);
            return;
        }

        // Default: query current price
        console.log('🔍 Current Price:\n');
        const price = await client.queryCurrentPrice();

        console.log('─────────────────────────────');
        console.log(`Price:        ${price.price}`);
        console.log(`Confidence:   ${price.conf}`);
        console.log(`Exponent:     ${price.expo}`);
        console.log(`Publish Time: ${price.publish_time}`);
        console.log(`              ${new Date(price.publish_time * 1000).toISOString()}`);

        // Calculate human-readable price
        const humanPrice = parseInt(price.price) / Math.pow(10, Math.abs(price.expo));
        const humanConf = parseInt(price.conf) / Math.pow(10, Math.abs(price.expo));
        console.log('\nFormatted:');
        console.log(`Price:        $${humanPrice.toFixed(8)} +/- $${humanConf.toFixed(8)}`);

        // Check staleness
        const now = Math.floor(Date.now() / 1000);
        const age = now - price.publish_time;
        console.log(`\nAge:          ${age} seconds`);

        if (age > 300) {
            console.log('Warning: Price data is stale (>5 minutes old)');
        } else {
            console.log('Price data is fresh');
        }
    } catch (error) {
        console.error(`\nQuery failed: ${sanitizeError(error)}`);
        process.exit(1);
    }
}

async function statusCommand() {
    console.log('📋 Contract Status...\n');

    const config = loadConfig();
    const client = new HermesClient({
        rpcEndpoint: config.rpc,
        contractAddress: config.contract,
        mnemonic: config.mnemonic,
    });

    try {
        await client.initialize();
        const status = client.getStatus();

        console.log('Client Status:');
        console.log('─────────────────────────────');
        console.log(`Address:          ${status.address}`);
        console.log(`Contract:         ${status.contractAddress}`);
        console.log(`Price Feed ID:    ${status.priceFeedId}`);
        console.log(`Running:          ${status.isRunning ? '✅' : '❌'}`);
        console.log(`RPC Endpoint:     ${config.rpc}`);
        console.log(`Hermes Endpoint:  ${config.hermes || 'https://hermes.pyth.network'}`);
    } catch (error) {
        console.error(`\n❌ Status check failed: ${sanitizeError(error)}`);
        process.exit(1);
    }
}

async function daemonCommand() {
    console.log('🤖 Starting daemon mode...\n');

    const config = loadConfig();
    const client = new HermesClient({
        rpcEndpoint: config.rpc,
        contractAddress: config.contract,
        mnemonic: config.mnemonic,
        hermesEndpoint: config.hermes,
        updateIntervalMs: config.interval,
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n\n🛑 Shutting down daemon...');
        client.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n\n🛑 Shutting down daemon...');
        client.stop();
        process.exit(0);
    });

    try {
        await client.start();
        console.log('✅ Daemon started. Press Ctrl+C to stop.\n');
    } catch (error) {
        console.error(`❌ Daemon failed to start: ${sanitizeError(error)}`);
        process.exit(1);
    }
}

// Admin commands
async function adminRefreshParams() {
    console.log('Refreshing oracle parameters...\n');

    const config = loadConfig();
    const client = new HermesClient({
        rpcEndpoint: config.rpc,
        contractAddress: config.contract,
        mnemonic: config.mnemonic,
    });

    try {
        await client.initialize();
        const txHash = await client.refreshOracleParams();
        console.log(`Oracle params refreshed successfully!`);
        console.log(`TX: ${txHash}`);
    } catch (error) {
        console.error(`\nFailed to refresh params: ${sanitizeError(error)}`);
        process.exit(1);
    }
}

async function adminUpdateFee(newFee: string) {
    validateFee(newFee);
    console.log(`Updating fee to ${newFee}...\n`);

    const config = loadConfig();
    const client = new HermesClient({
        rpcEndpoint: config.rpc,
        contractAddress: config.contract,
        mnemonic: config.mnemonic,
    });

    try {
        await client.initialize();
        const txHash = await client.updateFee(newFee);
        console.log(`Fee updated successfully!`);
        console.log(`TX: ${txHash}`);
    } catch (error) {
        console.error(`\nFailed to update fee: ${sanitizeError(error)}`);
        process.exit(1);
    }
}

async function adminTransfer(newAdmin: string) {
    validateBech32Address(newAdmin);
    console.log(`Transferring admin to ${newAdmin}...\n`);

    const config = loadConfig();
    const client = new HermesClient({
        rpcEndpoint: config.rpc,
        contractAddress: config.contract,
        mnemonic: config.mnemonic,
    });

    try {
        await client.initialize();
        const txHash = await client.transferAdmin(newAdmin);
        console.log(`Admin transferred successfully!`);
        console.log(`TX: ${txHash}`);
    } catch (error) {
        console.error(`\nFailed to transfer admin: ${sanitizeError(error)}`);
        process.exit(1);
    }
}

// Setup CLI
program
    .name('hermes-cli')
    .description('CLI tool for managing Akash oracle updates')
    .version('1.0.0');

program
    .command('update')
    .description('Update oracle price once')
    .action(updateCommand);

program
    .command('query')
    .description('Query data from contract')
    .option('--feed', 'Query price feed with metadata')
    .option('--config', 'Query contract configuration')
    .option('--oracle-params', 'Query cached oracle parameters')
    .action(queryCommand);

program
    .command('status')
    .description('Show contract and client status')
    .action(statusCommand);

program
    .command('daemon')
    .description('Run continuous updates (daemon mode)')
    .action(daemonCommand);

// Admin subcommands
const admin = program
    .command('admin')
    .description('Admin operations (requires admin privileges)');

admin
    .command('refresh-params')
    .description('Refresh cached oracle parameters from chain')
    .action(adminRefreshParams);

admin
    .command('update-fee <fee>')
    .description('Update the price update fee (in uakt)')
    .action(adminUpdateFee);

admin
    .command('transfer <address>')
    .description('Transfer admin rights to new address')
    .action(adminTransfer);

// Parse arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
    program.outputHelp();
}