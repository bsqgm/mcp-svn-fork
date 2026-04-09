# Troubleshooting MCP SVN

## Typical Error

```text
Error: The directory 'C:\your\directory' is not a valid SVN working copy.
Run the command inside an SVN checkout or perform a checkout first.
```

This usually happens when you run SVN commands such as `svn info` or `svn status` in a directory that is not under SVN version control.

## Fixes

### 1. Point to the correct working copy

```bash
# Linux/macOS
export SVN_WORKING_DIRECTORY="/path/to/your/working-copy"

# Windows CMD
set SVN_WORKING_DIRECTORY=C:\path\to\your\working-copy

# Windows PowerShell
$env:SVN_WORKING_DIRECTORY="C:\path\to\your\working-copy"
```

### 2. Check out the repository first

```ts
svn_checkout({
  url: "https://your-svn-server.com/repo/trunk",
  path: "my-project"
})
```

### 3. Verify the directory really is an SVN working copy

```bash
svn info
svn status
ls -la .svn
```

## Environment Configuration

| Variable | Description | Example |
| --- | --- | --- |
| `SVN_PATH` | SVN executable path | `svn` |
| `SVN_WORKING_DIRECTORY` | Working copy directory | `C:/my-project` |
| `SVN_USERNAME` | SVN username | `user@company.com` |
| `SVN_PASSWORD` | SVN password | `my-password` |
| `SVN_TIMEOUT` | Command timeout in milliseconds | `60000` |

## System Verification

### Check SVN installation

```bash
svn --version
```

### Run the built-in health check

Use `svn_health_check()` to verify:

- SVN is available
- The working copy is valid
- The repository can be reached

### Test basic commands

```bash
svn info
svn status
svn log --limit 1
```

## Common Issues

### SVN command failed

Cause: the underlying SVN command returned a non-zero exit code.

Fix: inspect the detailed error message returned by the MCP tool.

### SVN not found

Cause: SVN is not installed or not in `PATH`.

Fix: install Subversion or set `SVN_PATH` explicitly.

### Authentication failed

Cause: missing, expired, or invalid credentials.

Fix: verify `SVN_USERNAME` and `SVN_PASSWORD`.

### Too many failed authentication attempts

Cause: incorrect credentials may be cached by SVN.

Fix: run `svn_clear_credentials()` and retry.

### Working copy locked

Cause: a previous SVN operation was interrupted.

Fix: run `svn_cleanup()`.

## Diagnostic Tools

### Full diagnosis

Run:

```ts
svn_diagnose()
```

### Manual step-by-step checks

```bash
svn --version
svn info --non-interactive
svn status
svn log --limit 1
```

## If Problems Persist

1. Review MCP logs for the exact failing command.
2. Verify file and directory permissions.
3. Confirm the working copy is healthy with native SVN commands.
4. Confirm the SVN server is reachable from the machine.

Always start with `svn_health_check()` when debugging configuration issues.
