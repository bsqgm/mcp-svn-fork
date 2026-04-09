# Error Handling Notes for MCP SVN

This note summarizes the fixes added for cases where `svn_status` and `svn_log` could fail with exit code `1` while simpler commands such as `svn_health_check` and `svn_info` still worked.

## Changes Made

### 1. Safer remote status handling

- `svn status --show-updates` is attempted first.
- If it fails, the server falls back to local-only `svn status`.
- This keeps `svn_status` useful even when the remote repository is temporarily unreachable.

### 2. Better error messages

The server now classifies common SVN failures more explicitly, including:

- `E175002`: connectivity problems
- `E170001`: authentication failure
- `E215004`: too many failed authentication attempts
- invalid working copy state
- locked working copy state

### 3. Diagnostic tool

`svn_diagnose` was added to probe commands individually and report:

- local status result
- remote status result
- basic log result
- detected errors
- suggested fixes

### 4. Credential cache cleanup

`svn_clear_credentials` was added to help resolve `E215004` and similar cached-credential issues.

## How to Use the Improvements

### Run diagnostics

```ts
svn_diagnose()
```

### Run a health check

```ts
svn_health_check()
```

### Clear cached credentials

```ts
svn_clear_credentials()
```

### Retry status without remote dependency

`svn_status` now automatically falls back to local status when remote update checks fail.

## Typical Root Causes

### Connectivity problems

- the SVN server is unreachable
- a proxy or firewall is blocking traffic
- the working copy is out of sync with the server

### Authentication problems

- invalid credentials
- expired authentication session
- cached bad credentials

### Local working copy problems

- locked working copy
- damaged `.svn` metadata
- invalid working directory

## Recommended Checks

### For connectivity

1. Verify internet or network access.
2. Confirm the SVN server URL is correct.
3. Check proxy and firewall configuration.

### For authentication

1. Verify `SVN_USERNAME` and `SVN_PASSWORD`.
2. Try a native SVN command manually.
3. Clear cached credentials with `svn_clear_credentials()`.

### For local working copy issues

1. Confirm the directory is an SVN checkout.
2. Run `svn cleanup`.
3. Verify filesystem permissions.

## Compatibility

These changes are backward compatible. They do not remove existing behavior; they improve resilience and error reporting.
