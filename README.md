# SVN MCP Server

A full MCP (Model Context Protocol) server for working with Subversion (SVN). It exposes common SVN operations so AI agents can inspect repositories, review changes, and perform routine version-control workflows.

## Features

- Repository operations: `info`, `status`, `log`, `diff`, `checkout`, `update`
- File operations: `add`, `commit`, `delete`, `revert`
- Maintenance tools: `cleanup`, `health check`, `diagnostics`, credential cache cleanup
- Typed tool schemas powered by Zod
- Windows-friendly process execution and path handling
- Output decoding for non-UTF-8 SVN responses

## Requirements

- Node.js 18+
- Subversion (SVN) installed and available in `PATH`
- TypeScript for local development

## Install

### From npm

```bash
npm install -g @grec0/mcp-svn
```

### Local development

```bash
git clone https://github.com/gcorroto/mcp-svn.git
cd mcp-svn
npm install
npm run build
```

## Configuration

Environment variables:

| Variable | Description | Default |
| --- | --- | --- |
| `SVN_PATH` | Path to the SVN executable | `svn` |
| `SVN_WORKING_DIRECTORY` | Working directory | `process.cwd()` |
| `SVN_USERNAME` | SVN username | unset |
| `SVN_PASSWORD` | SVN password | unset |
| `SVN_TIMEOUT` | Command timeout in milliseconds | `30000` |

Example MCP configuration:

```json
{
  "mcpServers": {
    "svn": {
      "command": "npx",
      "args": ["@grec0/mcp-svn"],
      "env": {
        "SVN_PATH": "svn",
        "SVN_WORKING_DIRECTORY": "/path/to/working/copy",
        "SVN_USERNAME": "your_username",
        "SVN_PASSWORD": "your_password"
      }
    }
  }
}
```

## Verify SVN

```bash
svn --version
where svn        # Windows
which svn        # Linux/macOS
svn --version --verbose
```

If SVN is not installed, common errors include:

```text
'svn' is not recognized as an internal or external command
svn: command not found
```

## Available Tools

### Basic operations

`svn_health_check()`
Check SVN availability and working copy health.

`svn_info(path?: string)`
Get detailed information for the working copy or a specific file.

`svn_status(path?: string, showAll?: boolean)`
Show file status in the working copy.

`svn_log(path?: string, limit?: number, revision?: string)`
Show commit history from the repository.

`svn_diff(path?: string, oldRevision?: string, newRevision?: string)`
Show differences between file revisions.

`svn_checkout(url: string, path?: string, revision?: number | "HEAD")`
Check out an SVN repository.

`svn_update(path?: string, revision?: number | "HEAD" | "BASE" | "COMMITTED" | "PREV")`
Update the working copy.

### File operations

`svn_add(paths: string | string[])`
Add files to version control.

`svn_commit(message: string, paths?: string[])`
Commit changes to the repository.

`svn_delete(paths: string | string[])`
Delete files from version control.

`svn_revert(paths: string | string[])`
Revert local file changes.

### Maintenance

`svn_cleanup(path?: string)`
Clean up interrupted working copy operations.

`svn_diagnose()`
Run targeted diagnostics for local and remote SVN commands.

`svn_clear_credentials()`
Clear cached SVN credentials to help resolve repeated authentication failures.

## Usage Examples

```ts
// Check that SVN is available and the working copy is valid
svn_health_check()

// Inspect the repository
svn_info()
svn_status(undefined, true)
svn_log(undefined, 10)
svn_diff("src/index.ts")

// Work with files
svn_add(["src/new-file.ts"])
svn_commit("Add new file")
svn_revert(["src/index.ts"])

// Maintenance
svn_cleanup()
svn_clear_credentials()
```

## Scripts

```bash
npm run build
npm run test
npm run dev
npm run inspector
```

## Project Structure

```text
common/
  types.ts
  utils.ts
  version.ts
tools/
  svn-service.ts
tests/
  *.test.ts
index.ts
```

## Development Status

See [SVN_MCP_IMPLEMENTATION.md](./SVN_MCP_IMPLEMENTATION.md) for the implementation checklist.

Current status: core repository and file operations are implemented.

Planned next areas:

- Branching support
- Advanced SVN operations
- Analysis and reporting tools
- Batch workflows

## Troubleshooting

- SVN not found: install Subversion and ensure it is available in `PATH`.
- Not a working copy: run commands inside an SVN checkout or perform `svn checkout` first.
- Authentication problems: set `SVN_USERNAME` and `SVN_PASSWORD`, or run `svn_clear_credentials()`.
- Long-running commands timing out: increase `SVN_TIMEOUT`.

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for more details.

## License

MIT. See [LICENSE](./LICENSE).

## Contributing

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes.
4. Open a pull request.

## Links

- Repository: <https://github.com/gcorroto/mcp-svn>
- Issues: <https://github.com/gcorroto/mcp-svn/issues>
- Project wiki: <https://github.com/gcorroto/mcp-svn/wiki>
