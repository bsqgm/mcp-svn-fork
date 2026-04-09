import {
  SvnConfig,
  SvnResponse,
  SvnInfo,
  SvnStatus,
  SvnLogEntry,
  SvnCheckoutOptions,
  SvnUpdateOptions,
  SvnCommitOptions,
  SvnAddOptions,
  SvnDeleteOptions,
  SvnError
} from '../common/types.js';

import {
  createSvnConfig,
  executeSvnCommand,
  parseInfoOutput,
  parseStatusOutput,
  parseLogOutput,
  validateSvnInstallation,
  isWorkingCopy,
  normalizePath,
  validatePath,
  validateSvnUrl,
  cleanOutput,
  clearSvnCredentials
} from '../common/utils.js';

export class SvnService {
  private config: SvnConfig;

  constructor(config: Partial<SvnConfig> = {}) {
    this.config = createSvnConfig(config);
  }

  /**
   * Helper used to normalize common SVN errors.
   */
  private handleSvnError(error: any, operation: string): never {
    let message = `Failed to ${operation}`;

    if (error.message.includes('E155007') || error.message.includes('not a working copy')) {
      message = `The directory '${this.config.workingDirectory}' is not a valid SVN working copy. Run the command inside an SVN checkout or perform a checkout first.`;
    } else if (error.message.includes('E175002') || error.message.includes('Unable to connect')) {
      message = 'Unable to connect to the SVN repository. Check network connectivity and credentials.';
    } else if (error.message.includes('E170001') || error.message.includes('Authentication failed')) {
      message = 'SVN authentication failed. Verify SVN_USERNAME and SVN_PASSWORD.';
    } else if (error.message.includes('E155036') || error.message.includes('working copy locked')) {
      message = "The working copy is locked. Run 'svn cleanup' and try again.";
    } else if (error.message.includes('E200030') || error.message.includes('sqlite')) {
      message = "The working copy database is corrupted. Run 'svn cleanup' to repair it.";
    } else if (error.stderr && error.stderr.length > 0) {
      message = `${message}: ${error.stderr}`;
    } else {
      message = `${message}: ${error.message}`;
    }

    throw new SvnError(message);
  }

  /**
   * Verify that SVN is installed and the current configuration is usable.
   */
  async healthCheck(): Promise<SvnResponse<{
    svnAvailable: boolean;
    version?: string;
    workingCopyValid?: boolean;
    repositoryAccessible?: boolean;
  }>> {
    try {
      const svnAvailable = await validateSvnInstallation(this.config);
      if (!svnAvailable) {
        return {
          success: false,
          error: 'SVN is not available in the system PATH',
          command: 'svn --version',
          workingDirectory: this.config.workingDirectory!
        };
      }

      const versionResponse = await executeSvnCommand(this.config, ['--version', '--quiet']);
      const version = versionResponse.data as string;
      const workingCopyValid = await isWorkingCopy(this.config.workingDirectory!);

      let repositoryAccessible = false;
      if (workingCopyValid) {
        try {
          await this.getInfo();
          repositoryAccessible = true;
        } catch {
          repositoryAccessible = false;
        }
      }

      return {
        success: true,
        data: {
          svnAvailable,
          version: version.trim(),
          workingCopyValid,
          repositoryAccessible
        },
        command: 'health-check',
        workingDirectory: this.config.workingDirectory!
      };

    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        command: 'health-check',
        workingDirectory: this.config.workingDirectory!
      };
    }
  }

  /**
   * Get info for the working copy or a specific target.
   */
  async getInfo(path?: string): Promise<SvnResponse<SvnInfo>> {
    try {
      const args = ['info'];
      if (path) {
        if (validateSvnUrl(path)) {
          args.push(path);
        } else if (validatePath(path)) {
          args.push(normalizePath(path));
        } else {
          throw new SvnError(`Invalid path or URL: ${path}`);
        }
      }

      const response = await executeSvnCommand(this.config, args);
      const info = parseInfoOutput(cleanOutput(response.data as string));

      return {
        success: true,
        data: info,
        command: response.command,
        workingDirectory: response.workingDirectory,
        executionTime: response.executionTime
      };

    } catch (error: any) {
      this.handleSvnError(error, 'get SVN info');
    }
  }

  /**
   * Get file status in the working copy.
   */
  async getStatus(path?: string, showAll: boolean = false): Promise<SvnResponse<SvnStatus[]>> {
    try {
      const args = ['status'];

      if (path) {
        if (!validatePath(path)) {
          throw new SvnError(`Invalid path: ${path}`);
        }
        args.push(normalizePath(path));
      }

      let response;

      if (showAll) {
        try {
          response = await executeSvnCommand(this.config, [...args, '--show-updates']);
        } catch (error: any) {
          console.warn(`Warning: --show-updates failed, falling back to local status only: ${error.message}`);
          response = await executeSvnCommand(this.config, args);
        }
      } else {
        response = await executeSvnCommand(this.config, args);
      }

      const statusList = parseStatusOutput(cleanOutput(response.data as string));

      return {
        success: true,
        data: statusList,
        command: response.command,
        workingDirectory: response.workingDirectory,
        executionTime: response.executionTime
      };

    } catch (error: any) {
      this.handleSvnError(error, 'get SVN status');
    }
  }

  /**
   * Get repository log entries.
   */
  async getLog(
    path?: string,
    limit?: number,
    revision?: string
  ): Promise<SvnResponse<SvnLogEntry[]>> {
    try {
      const args = ['log', '--xml'];

      if (limit && limit > 0) {
        args.push('--limit', limit.toString());
      }

      if (revision) {
        args.push('--revision', revision);
      }

      if (path) {
        if (!validatePath(path)) {
          throw new SvnError(`Invalid path: ${path}`);
        }
        args.push(normalizePath(path));
      }

      let response;
      try {
        response = await executeSvnCommand(this.config, args);
      } catch (error: any) {
        if ((error.message.includes('spawn') && error.message.includes('ENOENT')) || error.code === 127) {
          const enhancedError = new SvnError(
            'SVN is not installed or not available in PATH. Install Subversion to use this command.'
          );
          enhancedError.command = error.command;
          enhancedError.code = error.code;
          throw enhancedError;
        }

        if (
          error.message.includes('E175002') ||
          error.message.includes('Unable to connect') ||
          error.message.includes('Connection refused') ||
          error.message.includes('Network is unreachable') ||
          error.code === 1
        ) {
          console.warn(`Remote log failed, likely a connectivity issue: ${error.message}`);

          const enhancedError = new SvnError(
            `Unable to retrieve SVN history. Possible causes:\n- No connectivity to the SVN server\n- Credentials are required but were not provided\n- The SVN server is temporarily unavailable\n- The working copy is not synchronized with the remote repository`
          );
          enhancedError.command = error.command;
          enhancedError.stderr = error.stderr;
          enhancedError.code = error.code;
          throw enhancedError;
        }

        throw error;
      }

      const logEntries = parseLogOutput(cleanOutput(response.data as string));

      return {
        success: true,
        data: logEntries,
        command: response.command,
        workingDirectory: response.workingDirectory,
        executionTime: response.executionTime
      };

    } catch (error: any) {
      this.handleSvnError(error, 'get SVN log');
    }
  }

  /**
   * Get a diff between revisions or the working copy.
   */
  async getDiff(
    path?: string,
    oldRevision?: string,
    newRevision?: string
  ): Promise<SvnResponse<string>> {
    try {
      const args = ['diff'];

      if (oldRevision && newRevision) {
        args.push('--old', `${path || '.'}@${oldRevision}`);
        args.push('--new', `${path || '.'}@${newRevision}`);
      } else if (oldRevision) {
        args.push('--revision', oldRevision);
        if (path) {
          args.push(normalizePath(path));
        }
      } else if (path) {
        if (!validatePath(path)) {
          throw new SvnError(`Invalid path: ${path}`);
        }
        args.push(normalizePath(path));
      }

      const response = await executeSvnCommand(this.config, args);

      return {
        success: true,
        data: cleanOutput(response.data as string),
        command: response.command,
        workingDirectory: response.workingDirectory,
        executionTime: response.executionTime
      };

    } catch (error: any) {
      throw new SvnError(`Failed to get SVN diff: ${error.message}`);
    }
  }

  /**
   * Check out a repository.
   */
  async checkout(
    url: string,
    path?: string,
    options: SvnCheckoutOptions = {}
  ): Promise<SvnResponse<string>> {
    try {
      if (!validateSvnUrl(url)) {
        throw new SvnError(`Invalid SVN URL: ${url}`);
      }

      const args = ['checkout'];

      if (options.revision) {
        args.push('--revision', options.revision.toString());
      }

      if (options.depth) {
        args.push('--depth', options.depth);
      }

      if (options.force) {
        args.push('--force');
      }

      if (options.ignoreExternals) {
        args.push('--ignore-externals');
      }

      args.push(url);

      if (path) {
        if (!validatePath(path)) {
          throw new SvnError(`Invalid path: ${path}`);
        }
        args.push(normalizePath(path));
      }

      const response = await executeSvnCommand(this.config, args);

      return {
        success: true,
        data: cleanOutput(response.data as string),
        command: response.command,
        workingDirectory: response.workingDirectory,
        executionTime: response.executionTime
      };

    } catch (error: any) {
      throw new SvnError(`Failed to checkout: ${error.message}`);
    }
  }

  /**
   * Update the working copy.
   */
  async update(
    path?: string,
    options: SvnUpdateOptions = {}
  ): Promise<SvnResponse<string>> {
    try {
      const args = ['update'];

      if (options.revision) {
        args.push('--revision', options.revision.toString());
      }

      if (options.force) {
        args.push('--force');
      }

      if (options.ignoreExternals) {
        args.push('--ignore-externals');
      }

      if (options.acceptConflicts) {
        args.push('--accept', options.acceptConflicts);
      }

      if (path) {
        if (!validatePath(path)) {
          throw new SvnError(`Invalid path: ${path}`);
        }
        args.push(normalizePath(path));
      }

      const response = await executeSvnCommand(this.config, args);

      return {
        success: true,
        data: cleanOutput(response.data as string),
        command: response.command,
        workingDirectory: response.workingDirectory,
        executionTime: response.executionTime
      };

    } catch (error: any) {
      throw new SvnError(`Failed to update: ${error.message}`);
    }
  }

  /**
   * Add files to version control.
   */
  async add(
    paths: string | string[],
    options: SvnAddOptions = {}
  ): Promise<SvnResponse<string>> {
    try {
      const pathArray = Array.isArray(paths) ? paths : [paths];

      for (const path of pathArray) {
        if (!validatePath(path)) {
          throw new SvnError(`Invalid path: ${path}`);
        }
      }

      const args = ['add'];

      if (options.force) {
        args.push('--force');
      }

      if (options.noIgnore) {
        args.push('--no-ignore');
      }

      if (options.autoProps) {
        args.push('--auto-props');
      }

      if (options.noAutoProps) {
        args.push('--no-auto-props');
      }

      if (options.parents) {
        args.push('--parents');
      }

      args.push(...pathArray.map(p => normalizePath(p)));

      const response = await executeSvnCommand(this.config, args);

      return {
        success: true,
        data: cleanOutput(response.data as string),
        command: response.command,
        workingDirectory: response.workingDirectory,
        executionTime: response.executionTime
      };

    } catch (error: any) {
      throw new SvnError(`Failed to add files: ${error.message}`);
    }
  }

  /**
   * Commit changes to the repository.
   */
  async commit(
    options: SvnCommitOptions,
    paths?: string[]
  ): Promise<SvnResponse<string>> {
    try {
      if (!options.message && !options.file) {
        throw new SvnError('Commit message is required');
      }

      const args = ['commit'];

      if (options.message) {
        args.push('--message', options.message);
      }

      if (options.file) {
        args.push('--file', normalizePath(options.file));
      }

      if (options.force) {
        args.push('--force');
      }

      if (options.keepLocks) {
        args.push('--keep-locks');
      }

      if (options.noUnlock) {
        args.push('--no-unlock');
      }

      if (paths && paths.length > 0) {
        for (const path of paths) {
          if (!validatePath(path)) {
            throw new SvnError(`Invalid path: ${path}`);
          }
        }
        args.push(...paths.map(p => normalizePath(p)));
      } else if (options.targets) {
        args.push(...options.targets.map(p => normalizePath(p)));
      }

      const response = await executeSvnCommand(this.config, args);

      return {
        success: true,
        data: cleanOutput(response.data as string),
        command: response.command,
        workingDirectory: response.workingDirectory,
        executionTime: response.executionTime
      };

    } catch (error: any) {
      throw new SvnError(`Failed to commit: ${error.message}`);
    }
  }

  /**
   * Delete files from version control.
   */
  async delete(
    paths: string | string[],
    options: SvnDeleteOptions = {}
  ): Promise<SvnResponse<string>> {
    try {
      const pathArray = Array.isArray(paths) ? paths : [paths];

      for (const path of pathArray) {
        if (!validatePath(path)) {
          throw new SvnError(`Invalid path: ${path}`);
        }
      }

      const args = ['delete'];

      if (options.force) {
        args.push('--force');
      }

      if (options.keepLocal) {
        args.push('--keep-local');
      }

      if (options.message) {
        args.push('--message', options.message);
      }

      args.push(...pathArray.map(p => normalizePath(p)));

      const response = await executeSvnCommand(this.config, args);

      return {
        success: true,
        data: cleanOutput(response.data as string),
        command: response.command,
        workingDirectory: response.workingDirectory,
        executionTime: response.executionTime
      };

    } catch (error: any) {
      throw new SvnError(`Failed to delete files: ${error.message}`);
    }
  }

  /**
   * Revert local changes.
   */
  async revert(paths: string | string[]): Promise<SvnResponse<string>> {
    try {
      const pathArray = Array.isArray(paths) ? paths : [paths];

      for (const path of pathArray) {
        if (!validatePath(path)) {
          throw new SvnError(`Invalid path: ${path}`);
        }
      }

      const args = ['revert'];
      args.push(...pathArray.map(p => normalizePath(p)));

      const response = await executeSvnCommand(this.config, args);

      return {
        success: true,
        data: cleanOutput(response.data as string),
        command: response.command,
        workingDirectory: response.workingDirectory,
        executionTime: response.executionTime
      };

    } catch (error: any) {
      throw new SvnError(`Failed to revert files: ${error.message}`);
    }
  }

  /**
   * Clean up interrupted working copy state.
   */
  async cleanup(path?: string): Promise<SvnResponse<string>> {
    try {
      const args = ['cleanup'];

      if (path) {
        if (!validatePath(path)) {
          throw new SvnError(`Invalid path: ${path}`);
        }
        args.push(normalizePath(path));
      }

      const response = await executeSvnCommand(this.config, args);

      return {
        success: true,
        data: cleanOutput(response.data as string),
        command: response.command,
        workingDirectory: response.workingDirectory,
        executionTime: response.executionTime
      };

    } catch (error: any) {
      throw new SvnError(`Failed to cleanup: ${error.message}`);
    }
  }

  /**
   * Diagnose command-level issues that commonly block SVN workflows.
   */
  async diagnoseCommands(): Promise<SvnResponse<{
    statusLocal: boolean;
    statusRemote: boolean;
    logBasic: boolean;
    workingCopyPath: string;
    errors: string[];
    suggestions: string[];
  }>> {
    const results = {
      statusLocal: false,
      statusRemote: false,
      logBasic: false,
      workingCopyPath: this.config.workingDirectory!,
      errors: [] as string[],
      suggestions: [] as string[]
    };

    try {
      try {
        await executeSvnCommand(this.config, ['status']);
        results.statusLocal = true;
      } catch (error: any) {
        const errorMsg = this.categorizeError(error, 'local status');
        results.errors.push(errorMsg.message);
        if (errorMsg.suggestion) {
          results.suggestions.push(errorMsg.suggestion);
        }
      }

      try {
        await executeSvnCommand(this.config, ['status', '--show-updates']);
        results.statusRemote = true;
      } catch (error: any) {
        const errorMsg = this.categorizeError(error, 'remote status');
        results.errors.push(errorMsg.message);
        if (errorMsg.suggestion) {
          results.suggestions.push(errorMsg.suggestion);
        }
      }

      try {
        await executeSvnCommand(this.config, ['log', '--limit', '1']);
        results.logBasic = true;
      } catch (error: any) {
        const errorMsg = this.categorizeError(error, 'basic log');
        results.errors.push(errorMsg.message);
        if (errorMsg.suggestion) {
          results.suggestions.push(errorMsg.suggestion);
        }
      }

      if (!results.statusRemote && !results.logBasic && results.statusLocal) {
        results.suggestions.push('Remote commands are failing while local commands work. Check network connectivity and SVN credentials.');
      }

      return {
        success: true,
        data: results,
        command: 'diagnostic',
        workingDirectory: this.config.workingDirectory!
      };

    } catch (error: any) {
      results.errors.push(`General error: ${error.message}`);
      return {
        success: false,
        data: results,
        error: error.message,
        command: 'diagnostic',
        workingDirectory: this.config.workingDirectory!
      };
    }
  }

  /**
   * Classify command failures and return a targeted suggestion.
   */
  private categorizeError(error: any, commandType: string): { message: string; suggestion?: string } {
    const baseMessage = `${commandType} failed`;

    if ((error.message.includes('spawn') && error.message.includes('ENOENT')) || error.code === 127) {
      return {
        message: `${baseMessage}: SVN is not installed or not available in PATH`,
        suggestion: 'Install SVN (Subversion) or verify that it is available in the system PATH'
      };
    }

    if (
      error.message.includes('E175002') ||
      error.message.includes('Unable to connect') ||
      error.message.includes('Connection refused') ||
      error.message.includes('Network is unreachable')
    ) {
      return {
        message: `${baseMessage}: unable to reach the SVN server`,
        suggestion: 'Check network connectivity and confirm that the SVN server is accessible'
      };
    }

    if (
      error.message.includes('E215004') ||
      error.message.includes('No more credentials') ||
      error.message.includes('we tried too many times')
    ) {
      return {
        message: `${baseMessage}: too many failed authentication attempts`,
        suggestion: 'Cached credentials may be wrong. Clear the SVN credentials cache and verify SVN_USERNAME and SVN_PASSWORD.'
      };
    }

    if (
      error.message.includes('E170001') ||
      error.message.includes('Authentication failed') ||
      error.message.includes('authorization failed')
    ) {
      return {
        message: `${baseMessage}: authentication failed`,
        suggestion: 'Verify your SVN credentials, especially SVN_USERNAME and SVN_PASSWORD'
      };
    }

    if (error.message.includes('E155007') || error.message.includes('not a working copy')) {
      return {
        message: `${baseMessage}: not a valid working copy`,
        suggestion: 'Run the command inside an SVN checkout or execute svn checkout first'
      };
    }

    if (error.message.includes('E155036') || error.message.includes('working copy locked')) {
      return {
        message: `${baseMessage}: working copy is locked`,
        suggestion: 'Run "svn cleanup" to unlock the working copy'
      };
    }

    if (error.code === 1) {
      return {
        message: `${baseMessage}: command exited with code 1 (possible network or authentication issue)`,
        suggestion: 'Check network connectivity, SVN credentials, and repository accessibility'
      };
    }

    return {
      message: `${baseMessage}: ${error.message}`,
      suggestion: undefined
    };
  }

  /**
   * Clear cached SVN credentials to help with authentication failures.
   */
  async clearCredentials(): Promise<SvnResponse> {
    return await clearSvnCredentials(this.config);
  }
}
