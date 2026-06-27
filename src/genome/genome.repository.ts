import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils';

export interface IGenomeContract {
  inputs?: string[];
  outputs?: string[];
  emits?: string[];
  throws?: string[];
}

export interface IGenomeComponent {
  path: string;
  purpose: string;
  riskLevel: string;
}

export interface IGenomePermissions {
  allowedFileSystemAccess: string[];
  allowedNetworkAccess: string[];
}

export interface IGenomeRepository {
  getContract(componentName: string): Promise<IGenomeContract | undefined>;
  getComponent(componentName: string): Promise<IGenomeComponent | undefined>;
  getPermissions(componentName: string): Promise<IGenomePermissions | undefined>;
  reload(): Promise<void>;
}

export class GenomeRepository implements IGenomeRepository {
  private contractsCache: Record<string, IGenomeContract> = {};
  private componentsCache: Record<string, IGenomeComponent> = {};
  private permissionsCache: Record<string, IGenomePermissions> = {};

  private loaded = false;

  constructor(private projectRoot: string) {}

  public async reload(): Promise<void> {
    Logger.info(`[GenomeRepository] Reloading genome data into memory...`);
    
    try {
      const contractsPath = path.join(this.projectRoot, 'src', 'genome', 'contracts.json');
      const contractsData = JSON.parse(await fs.readFile(contractsPath, 'utf8'));
      this.contractsCache = contractsData.contracts || {};
    } catch (e) {
      Logger.warn(`[GenomeRepository] Failed to load contracts.json`);
    }

    try {
      const componentsPath = path.join(this.projectRoot, 'src', 'genome', 'components.json');
      const componentsData = JSON.parse(await fs.readFile(componentsPath, 'utf8'));
      this.componentsCache = componentsData.components || {};
    } catch (e) {
      Logger.warn(`[GenomeRepository] Failed to load components.json`);
    }

    try {
      const permissionsPath = path.join(this.projectRoot, 'src', 'genome', 'permissions.json');
      const permissionsData = JSON.parse(await fs.readFile(permissionsPath, 'utf8'));
      this.permissionsCache = permissionsData.permissions || {};
    } catch (e) {
      Logger.warn(`[GenomeRepository] Failed to load permissions.json`);
    }

    this.loaded = true;
  }

  private async ensureLoaded() {
    if (!this.loaded) {
      await this.reload();
    }
  }

  public async getContract(componentName: string): Promise<IGenomeContract | undefined> {
    await this.ensureLoaded();
    return this.contractsCache[componentName];
  }

  public async getComponent(componentName: string): Promise<IGenomeComponent | undefined> {
    await this.ensureLoaded();
    return this.componentsCache[componentName];
  }

  public async getPermissions(componentName: string): Promise<IGenomePermissions | undefined> {
    await this.ensureLoaded();
    return this.permissionsCache[componentName];
  }
}
