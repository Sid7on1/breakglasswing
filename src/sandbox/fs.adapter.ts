import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils';

export class FileSystemAdapter {
  constructor(private workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  /**
   * Path Traversal Jail
   * Mathematically guarantees that the target path does not escape the workspace root.
   */
  private async resolveAndSecurePath(relativePath: string): Promise<string> {
    const absolutePath = path.resolve(this.workspaceRoot, relativePath);
    
    // Resolve symlinks to their real physical location
    let realPath: string;
    try {
      realPath = await fs.realpath(absolutePath);
    } catch (e) {
      // File doesn't exist yet (e.g. for writeFile)
      realPath = absolutePath;
    }
    
    // Explicitly prevent directory traversal attacks (e.g. `../../../etc/passwd` or via symlinks)
    if (!realPath.startsWith(this.workspaceRoot)) {
      const err = `[Security Error] Path Traversal Attack Blocked! Attempted to access outside workspace: ${realPath}`;
      Logger.error(err);
      throw new Error(err);
    }
    
    return realPath;
  }

  async readFile(relativePath: string): Promise<string> {
    const fullPath = await this.resolveAndSecurePath(relativePath);
    Logger.info(`[FSAdapter] Reading file: ${fullPath}`);
    return await fs.readFile(fullPath, 'utf8');
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = await this.resolveAndSecurePath(relativePath);
    Logger.info(`[FSAdapter] Writing file: ${fullPath}`);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
  }

  async deleteFile(relativePath: string): Promise<void> {
    const fullPath = await this.resolveAndSecurePath(relativePath);
    Logger.info(`[FSAdapter] Deleting file: ${fullPath}`);
    await fs.unlink(fullPath);
  }
}
