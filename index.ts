#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { SvnService } from "./tools/svn-service.js";
import { formatDuration } from "./common/utils.js";
import { VERSION } from "./common/version.js";

const server = new McpServer({
  name: "svn-mcp-server",
  version: VERSION,
});

let svnService: SvnService | null = null;

function getSvnService(): SvnService {
  if (!svnService) {
    try {
      svnService = new SvnService();
    } catch (error: any) {
      throw new Error(`SVN configuration error: ${error.message}`);
    }
  }
  return svnService;
}

server.tool(
  "svn_health_check",
  "Check SVN availability and working copy health.",
  {},
  async () => {
    try {
      const result = await getSvnService().healthCheck();
      const data = result.data;

      const healthText =
        `**SVN System Status**\n\n` +
        `**SVN Available:** ${data?.svnAvailable ? "Yes" : "No"}\n` +
        `**Version:** ${data?.version || "N/A"}\n` +
        `**Valid Working Copy:** ${data?.workingCopyValid ? "Yes" : "No"}\n` +
        `**Repository Accessible:** ${data?.repositoryAccessible ? "Yes" : "No"}\n` +
        `**Working Directory:** ${result.workingDirectory}`;

      return { content: [{ type: "text", text: healthText }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `**Error:** ${error.message}` }] };
    }
  }
);

server.tool(
  "svn_diagnose",
  "Diagnose common SVN command issues.",
  {},
  async () => {
    try {
      const result = await getSvnService().diagnoseCommands();
      const data = result.data!;

      let diagnosticText =
        `**SVN Command Diagnostics**\n\n` +
        `**Working Directory:** ${data.workingCopyPath}\n\n` +
        `**Local Status:** ${data.statusLocal ? "OK" : "Failed"}\n` +
        `**Remote Status:** ${data.statusRemote ? "OK" : "Failed"}\n` +
        `**Basic Log:** ${data.logBasic ? "OK" : "Failed"}\n`;

      if (data.errors.length > 0) {
        diagnosticText += `\n**Detected Errors:**\n`;
        data.errors.forEach((error, index) => {
          diagnosticText += `${index + 1}. ${error}\n`;
        });
      }

      if (data.suggestions.length > 0) {
        diagnosticText += `\n**Suggestions:**\n`;
        data.suggestions.forEach((suggestion) => {
          diagnosticText += `- ${suggestion}\n`;
        });
      }

      return { content: [{ type: "text", text: diagnosticText }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `**Diagnostic Error:** ${error.message}` }] };
    }
  }
);

server.tool(
  "svn_info",
  "Get detailed information for the working copy or a specific file.",
  {
    path: z.string().optional().describe("Specific path to inspect (optional)"),
  },
  async (args) => {
    try {
      const result = await getSvnService().getInfo(args.path);
      const info = result.data!;

      const infoText =
        `**SVN Info**\n\n` +
        `**Path:** ${info.path}\n` +
        `**URL:** ${info.url}\n` +
        `**Relative URL:** ${info.relativeUrl}\n` +
        `**Repository Root:** ${info.repositoryRoot}\n` +
        `**UUID:** ${info.repositoryUuid}\n` +
        `**Revision:** ${info.revision}\n` +
        `**Node Kind:** ${info.nodeKind}\n` +
        `**Last Changed Author:** ${info.lastChangedAuthor}\n` +
        `**Last Changed Revision:** ${info.lastChangedRev}\n` +
        `**Last Changed Date:** ${info.lastChangedDate}\n` +
        `**Working Copy Root:** ${info.workingCopyRootPath}\n` +
        `**Execution Time:** ${formatDuration(result.executionTime || 0)}`;

      return { content: [{ type: "text", text: infoText }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `**Error:** ${error.message}` }] };
    }
  }
);

server.tool(
  "svn_status",
  "Show file status in the working copy.",
  {
    path: z.string().optional().describe("Specific path to inspect"),
    showAll: z.boolean().optional().default(false).describe("Include remote status when available"),
  },
  async (args) => {
    try {
      const result = await getSvnService().getStatus(args.path, args.showAll);
      const statusList = result.data!;

      if (statusList.length === 0) {
        return { content: [{ type: "text", text: "**No changes in the working copy**" }] };
      }

      const statusText =
        `**SVN Status** (${statusList.length} items)\n\n` +
        statusList.map((status) => `**${status.status.toUpperCase()}** - ${status.path}`).join("\n") +
        `\n\n**Execution Time:** ${formatDuration(result.executionTime || 0)}`;

      return { content: [{ type: "text", text: statusText }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `**Error:** ${error.message}` }] };
    }
  }
);

server.tool(
  "svn_log",
  "Show commit history from the repository.",
  {
    path: z.string().optional().describe("Specific path"),
    limit: z.number().optional().default(10).describe("Maximum number of entries"),
    revision: z.string().optional().describe("Specific revision or revision range, e.g. 100:200"),
  },
  async (args) => {
    try {
      const result = await getSvnService().getLog(args.path, args.limit, args.revision);
      const logEntries = result.data!;

      if (logEntries.length === 0) {
        return { content: [{ type: "text", text: "**No log entries found**" }] };
      }

      const logText =
        `**SVN History** (${logEntries.length} entries)\n\n` +
        logEntries
          .map(
            (entry, index) =>
              `**${index + 1}. Revision ${entry.revision}**\n` +
              `**Author:** ${entry.author}\n` +
              `**Date:** ${entry.date}\n` +
              `**Message:** ${entry.message || "No message"}\n` +
              `---`
          )
          .join("\n\n") +
        `\n**Execution Time:** ${formatDuration(result.executionTime || 0)}`;

      return { content: [{ type: "text", text: logText }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `**Error:** ${error.message}` }] };
    }
  }
);

server.tool(
  "svn_diff",
  "Show differences between file revisions.",
  {
    path: z.string().optional().describe("Specific path"),
    oldRevision: z.string().optional().describe("Old revision"),
    newRevision: z.string().optional().describe("New revision"),
  },
  async (args) => {
    try {
      const result = await getSvnService().getDiff(args.path, args.oldRevision, args.newRevision);
      const diffOutput = result.data!;

      if (!diffOutput || diffOutput.trim().length === 0) {
        return { content: [{ type: "text", text: "**No differences found**" }] };
      }

      const diffText =
        `**SVN Diff**\n\n` +
        `**Command:** ${result.command}\n` +
        `**Execution Time:** ${formatDuration(result.executionTime || 0)}\n\n` +
        `\`\`\`diff\n${diffOutput}\n\`\`\``;

      return { content: [{ type: "text", text: diffText }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `**Error:** ${error.message}` }] };
    }
  }
);

server.tool(
  "svn_checkout",
  "Check out an SVN repository.",
  {
    url: z.string().describe("SVN repository URL"),
    path: z.string().optional().describe("Destination directory"),
    revision: z.union([z.number(), z.literal("HEAD")]).optional().describe("Specific revision"),
    depth: z.enum(["empty", "files", "immediates", "infinity"]).optional().describe("Checkout depth"),
    force: z.boolean().optional().default(false).describe("Force checkout"),
    ignoreExternals: z.boolean().optional().default(false).describe("Ignore externals"),
  },
  async (args) => {
    try {
      const options = {
        revision: args.revision,
        depth: args.depth,
        force: args.force,
        ignoreExternals: args.ignoreExternals,
      };

      const result = await getSvnService().checkout(args.url, args.path, options);

      const checkoutText =
        `**Checkout Complete**\n\n` +
        `**URL:** ${args.url}\n` +
        `**Destination:** ${args.path || "Current directory"}\n` +
        `**Command:** ${result.command}\n` +
        `**Execution Time:** ${formatDuration(result.executionTime || 0)}\n\n` +
        `**Result:**\n\`\`\`\n${result.data}\n\`\`\``;

      return { content: [{ type: "text", text: checkoutText }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `**Error:** ${error.message}` }] };
    }
  }
);

server.tool(
  "svn_update",
  "Update the working copy from the repository.",
  {
    path: z.string().optional().describe("Specific path to update"),
    revision: z.union([z.number(), z.literal("HEAD"), z.literal("BASE"), z.literal("COMMITTED"), z.literal("PREV")]).optional().describe("Target revision"),
    force: z.boolean().optional().default(false).describe("Force update"),
    ignoreExternals: z.boolean().optional().default(false).describe("Ignore externals"),
    acceptConflicts: z.enum(["postpone", "base", "mine-conflict", "theirs-conflict", "mine-full", "theirs-full"]).optional().describe("How to handle conflicts"),
  },
  async (args) => {
    try {
      const options = {
        revision: args.revision,
        force: args.force,
        ignoreExternals: args.ignoreExternals,
        acceptConflicts: args.acceptConflicts,
      };

      const result = await getSvnService().update(args.path, options);

      const updateText =
        `**Update Complete**\n\n` +
        `**Path:** ${args.path || "Current directory"}\n` +
        `**Command:** ${result.command}\n` +
        `**Execution Time:** ${formatDuration(result.executionTime || 0)}\n\n` +
        `**Result:**\n\`\`\`\n${result.data}\n\`\`\``;

      return { content: [{ type: "text", text: updateText }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `**Error:** ${error.message}` }] };
    }
  }
);

server.tool(
  "svn_add",
  "Add files to version control.",
  {
    paths: z.union([z.string(), z.array(z.string())]).describe("File or directory path(s) to add"),
    force: z.boolean().optional().default(false).describe("Force add"),
    noIgnore: z.boolean().optional().default(false).describe("Do not respect ignore rules"),
    parents: z.boolean().optional().default(false).describe("Create parent directories if needed"),
    autoProps: z.boolean().optional().describe("Apply auto-properties"),
    noAutoProps: z.boolean().optional().describe("Do not apply auto-properties"),
  },
  async (args) => {
    try {
      const options = {
        force: args.force,
        noIgnore: args.noIgnore,
        parents: args.parents,
        autoProps: args.autoProps,
        noAutoProps: args.noAutoProps,
      };

      const result = await getSvnService().add(args.paths, options);
      const pathsArray = Array.isArray(args.paths) ? args.paths : [args.paths];

      const addText =
        `**Files Added**\n\n` +
        `**Files:** ${pathsArray.join(", ")}\n` +
        `**Command:** ${result.command}\n` +
        `**Execution Time:** ${formatDuration(result.executionTime || 0)}\n\n` +
        `**Result:**\n\`\`\`\n${result.data}\n\`\`\``;

      return { content: [{ type: "text", text: addText }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `**Error:** ${error.message}` }] };
    }
  }
);

server.tool(
  "svn_commit",
  "Commit changes to the repository.",
  {
    message: z.string().describe("Commit message"),
    paths: z.array(z.string()).optional().describe("Specific files to commit"),
    file: z.string().optional().describe("File containing the commit message"),
    force: z.boolean().optional().default(false).describe("Force commit"),
    keepLocks: z.boolean().optional().default(false).describe("Keep locks after commit"),
    noUnlock: z.boolean().optional().default(false).describe("Do not unlock files"),
  },
  async (args) => {
    try {
      const options = {
        message: args.message,
        file: args.file,
        force: args.force,
        keepLocks: args.keepLocks,
        noUnlock: args.noUnlock,
      };

      const result = await getSvnService().commit(options, args.paths);

      const commitText =
        `**Commit Complete**\n\n` +
        `**Message:** ${args.message}\n` +
        `**Files:** ${args.paths?.join(", ") || "All changes"}\n` +
        `**Command:** ${result.command}\n` +
        `**Execution Time:** ${formatDuration(result.executionTime || 0)}\n\n` +
        `**Result:**\n\`\`\`\n${result.data}\n\`\`\``;

      return { content: [{ type: "text", text: commitText }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `**Error:** ${error.message}` }] };
    }
  }
);

server.tool(
  "svn_delete",
  "Delete files from version control.",
  {
    paths: z.union([z.string(), z.array(z.string())]).describe("File or directory path(s) to delete"),
    message: z.string().optional().describe("Message for direct repository deletion"),
    force: z.boolean().optional().default(false).describe("Force deletion"),
    keepLocal: z.boolean().optional().default(false).describe("Keep the local copy"),
  },
  async (args) => {
    try {
      const options = {
        message: args.message,
        force: args.force,
        keepLocal: args.keepLocal,
      };

      const result = await getSvnService().delete(args.paths, options);
      const pathsArray = Array.isArray(args.paths) ? args.paths : [args.paths];

      const deleteText =
        `**Files Deleted**\n\n` +
        `**Files:** ${pathsArray.join(", ")}\n` +
        `**Keep Local Copy:** ${args.keepLocal ? "Yes" : "No"}\n` +
        `**Command:** ${result.command}\n` +
        `**Execution Time:** ${formatDuration(result.executionTime || 0)}\n\n` +
        `**Result:**\n\`\`\`\n${result.data}\n\`\`\``;

      return { content: [{ type: "text", text: deleteText }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `**Error:** ${error.message}` }] };
    }
  }
);

server.tool(
  "svn_revert",
  "Revert local file changes.",
  {
    paths: z.union([z.string(), z.array(z.string())]).describe("File or directory path(s) to revert"),
  },
  async (args) => {
    try {
      const result = await getSvnService().revert(args.paths);
      const pathsArray = Array.isArray(args.paths) ? args.paths : [args.paths];

      const revertText =
        `**Changes Reverted**\n\n` +
        `**Files:** ${pathsArray.join(", ")}\n` +
        `**Command:** ${result.command}\n` +
        `**Execution Time:** ${formatDuration(result.executionTime || 0)}\n\n` +
        `**Result:**\n\`\`\`\n${result.data}\n\`\`\``;

      return { content: [{ type: "text", text: revertText }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `**Error:** ${error.message}` }] };
    }
  }
);

server.tool(
  "svn_cleanup",
  "Clean up interrupted working copy operations.",
  {
    path: z.string().optional().describe("Specific path to clean"),
  },
  async (args) => {
    try {
      const result = await getSvnService().cleanup(args.path);

      const cleanupText =
        `**Cleanup Complete**\n\n` +
        `**Path:** ${args.path || "Current directory"}\n` +
        `**Command:** ${result.command}\n` +
        `**Execution Time:** ${formatDuration(result.executionTime || 0)}\n\n` +
        `**Result:**\n\`\`\`\n${result.data}\n\`\`\``;

      return { content: [{ type: "text", text: cleanupText }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `**Error:** ${error.message}` }] };
    }
  }
);

server.tool(
  "svn_clear_credentials",
  "Clear the SVN credentials cache to resolve authentication issues.",
  {},
  async () => {
    try {
      const result = await getSvnService().clearCredentials();

      const clearText =
        `**Credentials Cache Cleared**\n\n` +
        `**Command:** ${result.command}\n` +
        `**Execution Time:** ${formatDuration(result.executionTime || 0)}\n\n` +
        `**Result:**\n\`\`\`\n${result.data}\n\`\`\`\n\n` +
        `**Note:** This can help resolve errors such as:\n` +
        `- E215004: No more credentials or we tried too many times\n` +
        `- Authentication errors caused by incorrect cached credentials`;

      return { content: [{ type: "text", text: clearText }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `**Error:** ${error.message}` }] };
    }
  }
);

async function runServer() {
  try {
    console.error("Creating SVN MCP Server...");
    console.error("Server info: svn-mcp-server");
    console.error("Version:", VERSION);

    if (!process.env.SVN_PATH) {
      console.error("Info: SVN_PATH environment variable not set, using 'svn' from PATH");
    } else {
      console.error("SVN_PATH:", process.env.SVN_PATH);
    }

    if (!process.env.SVN_WORKING_DIRECTORY) {
      console.error("Info: SVN_WORKING_DIRECTORY not set, using current directory");
    } else {
      console.error("SVN_WORKING_DIRECTORY:", process.env.SVN_WORKING_DIRECTORY);
    }

    if (process.env.SVN_USERNAME) {
      console.error("SVN_USERNAME:", process.env.SVN_USERNAME);
    }

    if (process.env.SVN_PASSWORD) {
      console.error("SVN_PASSWORD:", "***");
    }

    console.error("Starting SVN MCP Server in stdio mode...");
    const transport = new StdioServerTransport();
    console.error("Connecting server to transport...");
    await server.connect(transport);

    console.error("MCP Server connected and ready!");
    console.error("Available tools:", [
      "svn_health_check",
      "svn_diagnose",
      "svn_info",
      "svn_status",
      "svn_log",
      "svn_diff",
      "svn_checkout",
      "svn_update",
      "svn_add",
      "svn_commit",
      "svn_delete",
      "svn_revert",
      "svn_cleanup",
      "svn_clear_credentials",
    ]);
  } catch (error) {
    console.error("Error starting server:", error);
    console.error("Stack trace:", (error as Error).stack);
    process.exit(1);
  }
}

runServer();
