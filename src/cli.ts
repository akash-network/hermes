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

import process from "node:process";
import { program } from "commander";
import { createCommandBuilder } from "./cli-commands/create-command-builder.ts";
import { updateCommand } from "./cli-commands/update-command.ts";
import { queryCommand } from "./cli-commands/query-command.ts";
import { statusCommand } from "./cli-commands/status-command.ts";
import { daemonCommand } from "./cli-commands/daemon-command.ts";
import { adminRefreshParams } from "./cli-commands/admin-refresh-params.ts";
import { adminUpdateFee } from "./cli-commands/admin-update-fee.ts";
import { adminTransfer } from "./cli-commands/admin-transfer.ts";

const command = createCommandBuilder({ process, console });

// Setup CLI
program
    .name("hermes-cli")
    .description("CLI tool for managing Akash oracle updates")
    .version("1.0.0");

program
    .command("update")
    .description("Update oracle price once")
    .action(command(updateCommand));

program
    .command("query")
    .description("Query data from contract")
    .option("--feed", "Query price feed with metadata")
    .option("--config", "Query contract configuration")
    .option("--oracle-params", "Query cached oracle parameters")
    .action(command(queryCommand));

program
    .command("status")
    .description("Show contract and client status")
    .action(command(statusCommand));

program
    .command("daemon")
    .description("Run continuous updates (daemon mode)")
    .action(command(daemonCommand));

// Admin subcommands
const admin = program
    .command("admin")
    .description("Admin operations (requires admin privileges)");

admin
    .command("refresh-params")
    .description("Refresh cached oracle parameters from chain")
    .action(command(adminRefreshParams));

admin
    .command("update-fee <fee>")
    .description("Update the price update fee (in uakt)")
    .action(command(adminUpdateFee));

admin
    .command("transfer <address>")
    .description("Transfer admin rights to new address")
    .action(command(adminTransfer));

// Parse arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
