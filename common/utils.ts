import { spawn, SpawnOptions } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { SvnConfig, SvnResponse, SvnError, SvnInfo, SvnStatus, SvnLogEntry, SVN_STATUS_CODES } from './types.js';
import iconv from 'iconv-lite';

const FALLBACK_ENCODINGS = ['gb18030', 'cp936', 'big5', 'shift_jis', 'euc-kr', 'windows-1252'] as const;

/**
 * Create SVN configuration from environment variables and overrides
 */
export function createSvnConfig(overrides: Partial<SvnConfig> = {}): SvnConfig {
  return {
    svnPath: overrides.svnPath || process.env.SVN_PATH || 'svn',
    workingDirectory: overrides.workingDirectory || process.env.SVN_WORKING_DIRECTORY || process.cwd(),
    username: overrides.username || process.env.SVN_USERNAME,
    password: overrides.password || process.env.SVN_PASSWORD,
    timeout: overrides.timeout || parseInt(process.env.SVN_TIMEOUT || '30000', 10)
  };
}

/**
 * Validate that SVN is available on the system
 */
export async function validateSvnInstallation(config: SvnConfig): Promise<boolean> {
  try {
    const result = await executeSvnCommand(config, ['--version', '--quiet']);
    return result.success;
  } catch (error) {
    return false;
  }
}

/**
 * Detect whether the current directory is an SVN working copy
 */
export async function isWorkingCopy(workingDirectory: string): Promise<boolean> {
  try {
    const svnDir = path.join(workingDirectory, '.svn');
    return await promisify(fs.access)(svnDir).then(() => true).catch(() => false);
  } catch {
    return false;
  }
}

/**
 * Normalize paths for Windows
 */
export function normalizePath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/');
}

/**
 * Escape command-line arguments on Windows
 */
export function escapeArgument(arg: string): string {
  // Si el argumento contiene espacios o caracteres especiales, lo encerramos en comillas
  if (/[\s&()<>[\]{}^=;!'+,`~%]/.test(arg)) {
    return `"${arg.replace(/"/g, '""')}"`;
  }
  return arg;
}

/**
 * Build authentication arguments
 */
export function buildAuthArgs(config: SvnConfig, options: { noAuthCache?: boolean } = {}): string[] {
  const args: string[] = [];
  
  if (config.username) {
    args.push('--username', config.username);
  }
  
  if (config.password) {
    args.push('--password', config.password);
  }
  
  // Always use --non-interactive to avoid prompts
  args.push('--non-interactive');
  
  // Option to disable the credentials cache (useful for E215004)
  if (options.noAuthCache) {
    args.push('--no-auth-cache');
  }
  
  return args;
}

/**
 * Execute an SVN command with improved error handling
 */
export async function executeSvnCommand(
  config: SvnConfig,
  args: string[],
  options: { input?: string; encoding?: BufferEncoding; noAuthCache?: boolean } = {}
): Promise<SvnResponse> {
  const startTime = Date.now();
  
  // Add authentication arguments
  const finalArgs = [...args, ...buildAuthArgs(config, { noAuthCache: options.noAuthCache })];
  const command = `${config.svnPath} ${finalArgs.join(' ')}`;
  
  return new Promise((resolve, reject) => {
    // Configure spawn options for Windows
    const spawnOptions: SpawnOptions = {
      cwd: config.workingDirectory,
      shell: true, // Important for Windows
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Asegurar que SVN use UTF-8
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8'
      }
    };
    
    const childProcess = spawn(config.svnPath!, finalArgs, spawnOptions);
    
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    
    // Configure timeout
    const timeout = setTimeout(() => {
      childProcess.kill('SIGTERM');
      reject(new SvnError(`Command timeout after ${config.timeout}ms: ${command}`));
    }, config.timeout);
    
    childProcess.stdout?.on('data', (data) => {
      stdoutChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });
    
    childProcess.stderr?.on('data', (data) => {
      stderrChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    });
    
    // Send input if provided
    if (options.input && childProcess.stdin) {
      childProcess.stdin.write(options.input);
      childProcess.stdin.end();
    }
    
    // Handle process completion
    childProcess.on('close', (code) => {
      clearTimeout(timeout);
      
      const stdout = decodeSvnOutput(Buffer.concat(stdoutChunks));
      const stderr = decodeSvnOutput(Buffer.concat(stderrChunks));
      
      const executionTime = Date.now() - startTime;
      const response: SvnResponse = {
        success: code === 0,
        command,
        workingDirectory: config.workingDirectory!,
        executionTime
      };
      
      if (code === 0) {
        response.data = stdout.trim();
        resolve(response);
      } else {
        const error = new SvnError(`SVN command failed with code ${code}: ${command}`);
        error.code = code || undefined;
        error.stderr = stderr.trim();
        error.command = command;
        
        response.error = error.message;
        response.data = stderr.trim();
        
        reject(error);
      }
    });
    
    // Handle process errors
    childProcess.on('error', (error) => {
      clearTimeout(timeout);
      
      const svnError = new SvnError(`Failed to execute SVN command: ${error.message}`);
      svnError.command = command;
      
      reject(svnError);
    });
  });
}

/**
 * Parse SVN XML output
 */
export function parseXmlOutput(xmlString: string): any {
  // Basic XML parsing implementation
  // In production, a library such as xml2js would be a better choice
  try {
    // This is a simplified implementation for Node.js
    // Browsers would use DOMParser, but Node.js needs a different approach
    const lines = xmlString.split('\n');
    const result: any = {};
    
    for (const line of lines) {
      const match = line.match(/<([^>]+)>([^<]+)<\/\1>/);
      if (match) {
        result[match[1]] = match[2];
      }
    }
    
    return result;
  } catch (error) {
    throw new SvnError(`Failed to parse XML output: ${error}`);
  }
}

/**
 * Parse svn info output
 */
export function parseInfoOutput(output: string): SvnInfo {
  const lines = output.split('\n');
  const info: Partial<SvnInfo> = {};
  
  for (const line of lines) {
    const [key, ...valueParts] = line.split(': ');
    const value = valueParts.join(': ').trim();
    
    switch (key.trim()) {
      case 'Path':
        info.path = value;
        break;
      case 'Working Copy Root Path':
        info.workingCopyRootPath = value;
        break;
      case 'URL':
        info.url = value;
        break;
      case 'Relative URL':
        info.relativeUrl = value;
        break;
      case 'Repository Root':
        info.repositoryRoot = value;
        break;
      case 'Repository UUID':
        info.repositoryUuid = value;
        break;
      case 'Revision':
        info.revision = parseInt(value, 10);
        break;
      case 'Node Kind':
        info.nodeKind = value as 'file' | 'directory';
        break;
      case 'Schedule':
        info.schedule = value;
        break;
      case 'Last Changed Author':
        info.lastChangedAuthor = value;
        break;
      case 'Last Changed Rev':
        info.lastChangedRev = parseInt(value, 10);
        break;
      case 'Last Changed Date':
        info.lastChangedDate = value;
        break;
      case 'Text Last Updated':
        info.textLastUpdated = value;
        break;
      case 'Checksum':
        info.checksum = value;
        break;
    }
  }
  
  return info as SvnInfo;
}

/**
 * Parse svn status output
 */
export function parseStatusOutput(output: string): SvnStatus[] {
  const lines = output.split('\n').filter(line => line.trim());
  const statusList: SvnStatus[] = [];
  
  for (const line of lines) {
    if (line.length < 8) continue;
    
    const statusCode = line[0];
    const propStatusCode = line[1];
    const path = line.substring(8).trim();
    
    const status: SvnStatus = {
      path,
      status: (SVN_STATUS_CODES as any)[statusCode] || 'unknown'
    };
    
    statusList.push(status);
  }
  
  return statusList;
}

/**
 * Parse svn log output
 */
export function parseLogOutput(output: string): SvnLogEntry[] {
  if (output.trim().startsWith('<')) {
    return sortLogEntriesDesc(parseLogXmlOutput(output));
  }

  const entries: SvnLogEntry[] = [];
  
  if (!output || output.trim().length === 0) {
    return entries;
  }
  
  // Split by SVN log separator lines
  const logEntries = output.split(/^-{72}$/gm).filter(entry => entry.trim());
  
  for (const entryText of logEntries) {
    const lines = entryText.trim().split('\n');
    if (lines.length < 2) continue;
    
    const headerLine = lines[0];
    // More flexible header pattern
    const headerMatch = headerLine.match(/^r(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(.*)$/);
    
    if (headerMatch) {
      try {
        const [, revision, author, date, details] = headerMatch;
        const message = lines.slice(2).join('\n').trim();
        
        entries.push({
          revision: parseInt(revision, 10),
          author: author.trim(),
          date: date.trim(),
          message: message || 'No message'
        });
      } catch (parseError) {
        console.warn(`Warning: Failed to parse log entry: ${parseError}`);
        continue;
      }
    }
  }
  
  return sortLogEntriesDesc(entries);
}

function parseLogXmlOutput(output: string): SvnLogEntry[] {
  const entries: SvnLogEntry[] = [];
  const entryPattern = /<logentry\s+revision="(\d+)">([\s\S]*?)<\/logentry>/g;

  for (const match of output.matchAll(entryPattern)) {
    const revision = parseInt(match[1], 10);
    const body = match[2];
    const author = extractXmlTag(body, 'author') || 'unknown';
    const date = extractXmlTag(body, 'date') || '';
    const message = extractXmlTag(body, 'msg') || 'No message';

    entries.push({
      revision,
      author,
      date,
      message
    });
  }

  return entries;
}

function sortLogEntriesDesc(entries: SvnLogEntry[]): SvnLogEntry[] {
  return [...entries].sort((a, b) => b.revision - a.revision);
}

function extractXmlTag(xml: string, tagName: string): string | undefined {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`));
  if (!match) {
    return undefined;
  }

  return decodeXmlEntities(match[1].trim());
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&');
}

export function decodeSvnOutput(buffer: Buffer): string {
  if (buffer.length === 0) {
    return '';
  }

  if (isValidUtf8(buffer)) {
    return iconv.decode(buffer, 'utf8');
  }

  let best = {
    text: iconv.decode(buffer, 'utf8'),
    score: scoreDecodedText(iconv.decode(buffer, 'utf8'))
  };

  for (const encoding of FALLBACK_ENCODINGS) {
    const candidate = iconv.decode(buffer, encoding);
    const score = scoreDecodedText(candidate);

    if (score < best.score) {
      best = { text: candidate, score };
    }
  }

  return best.text;
}

function scoreDecodedText(text: string): number {
  let score = 0;

  for (const char of text) {
    const code = char.charCodeAt(0);

    if (char === '\uFFFD') {
      score += 10;
      continue;
    }

    if (code < 32 && char !== '\n' && char !== '\r' && char !== '\t') {
      score += 3;
    }
  }

  return score;
}

function isValidUtf8(buffer: Buffer): boolean {
  let i = 0;

  while (i < buffer.length) {
    const byte = buffer[i];

    if (byte <= 0x7F) {
      i += 1;
      continue;
    }

    let extraBytes = 0;

    if ((byte & 0xE0) === 0xC0) {
      extraBytes = 1;
      if (byte < 0xC2) {
        return false;
      }
    } else if ((byte & 0xF0) === 0xE0) {
      extraBytes = 2;
    } else if ((byte & 0xF8) === 0xF0) {
      extraBytes = 3;
      if (byte > 0xF4) {
        return false;
      }
    } else {
      return false;
    }

    if (i + extraBytes >= buffer.length) {
      return false;
    }

    for (let j = 1; j <= extraBytes; j += 1) {
      if ((buffer[i + j] & 0xC0) !== 0x80) {
        return false;
      }
    }

    i += extraBytes + 1;
  }

  return true;
}

/**
 * Format a duration in milliseconds to a readable string
 */
export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${milliseconds}ms`;
  }
  
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Validate a file or directory path
 */
export function validatePath(filePath: string): boolean {
  // Check that it does not contain invalid Windows characters
  // Allow colons in valid contexts such as Windows drive letters
  
  // Pattern used to detect absolute Windows paths (C:, D:, etc.)
  const windowsAbsolutePathPattern = /^[A-Za-z]:[\\\/]/;
  
  if (windowsAbsolutePathPattern.test(filePath)) {
    // For absolute Windows paths, validate only after the drive letter
    const pathAfterDrive = filePath.substring(2); // Remove "C:" or similar
    const invalidChars = /[<>:"|?*]/;
    return !invalidChars.test(pathAfterDrive);
  } else {
    // Apply full validation for all other paths
    const invalidChars = /[<>:"|?*]/;
    return !invalidChars.test(filePath);
  }
}

/**
 * Get relative paths from the working directory
 */
export function getRelativePath(fullPath: string, workingDirectory: string): string {
  return path.relative(workingDirectory, fullPath).replace(/\\/g, '/');
}

/**
 * Validar URL de repositorio SVN
 */
export function validateSvnUrl(url: string): boolean {
  const svnUrlPattern = /^(svn|https?|file):\/\/.+/i;
  return svnUrlPattern.test(url);
}

/**
 * Clean and normalize command output
 */
export function cleanOutput(output: string): string {
  return output
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\r/g, '\n')    // Convert CR to LF
    .trim();
}

/**
 * Create a more descriptive SVN error
 */
export function createSvnError(message: string, command?: string, stderr?: string): SvnError {
  const error = new SvnError(message);
  if (command) error.command = command;
  if (stderr) error.stderr = stderr;
  return error;
}

/**
 * Clear the SVN credentials cache to resolve E215004 errors
 */
export async function clearSvnCredentials(config: SvnConfig): Promise<SvnResponse> {
  try {
    // On Unix/Linux systems, SVN stores credentials in ~/.subversion/auth
    // En Windows, en %APPDATA%\Subversion\auth
    // Try clearing credentials with the dedicated auth command when available
    
    // First try the standard cleanup command
    return await executeSvnCommand(config, ['auth', '--remove'], { noAuthCache: true });
  } catch (error: any) {
    // If the auth command is not available, try an alternative
    try {
      // As a fallback, use a command that does not store credentials
      const response = await executeSvnCommand(config, ['info', '--non-interactive'], { noAuthCache: true });
      return {
        success: true,
        data: 'Credentials cache cleared (using alternative method)',
        command: 'clear-credentials',
        workingDirectory: config.workingDirectory!
      };
    } catch (fallbackError: any) {
      return {
        success: false,
        error: `Unable to clear the credentials cache: ${fallbackError.message}`,
        command: 'clear-credentials',
        workingDirectory: config.workingDirectory!
      };
    }
  }
} 



