/**
 * Adaptateur de compétences et de protocoles inter-plateformes (§2.C et §3.6
 * du PRD).
 *
 * Il traduit les manifestes, schémas et définitions de paramètres entre le
 * format d'outil Anti-Gravity et les structures de Claude Code : déclarations
 * d'outils MCP, commandes slash et règles Markdown. Il résout également les
 * chemins de déploiement propres à chaque agent, ce qui permet aux trois
 * actions d'intégration de viser la bonne destination sans connaître l'agent.
 */

import * as path from 'path';
import { AgentRuntime, DeployTarget, DiscoveryResourceType } from '../common/eventTypes';
import { extractFrontmatter } from '../utils/frontmatter';
import { getEffectiveGlobalAntigravityPath, getEffectiveGlobalClaudePath } from '../utils/paths';

/**
 * Représentation neutre d'une compétence, pivot entre les deux dialectes.
 */
export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  type: DiscoveryResourceType;
  version?: string;
  tags: string[];
  /** Corps Markdown des instructions, hors frontmatter. */
  body: string;
  /** Paramètres déclarés, utilisés pour produire un schéma d'outil MCP. */
  parameters: SkillParameter[];
}

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
}

/** Déclaration d'outil conforme au protocole MCP (Model Context Protocol). */
export interface McpToolDeclaration {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface DeploymentPaths {
  /** Répertoire racine où la ressource sera écrite. */
  directory: string;
  /** Chemin complet du fichier principal de la ressource. */
  file: string;
  /** Vrai lorsque la ressource occupe un dossier dédié (cas des compétences). */
  isFolder: boolean;
}

export class SkillProtocolAdapter {
  /**
   * Analyse un manifeste Markdown (SKILL.md ou fichier de règle) et en extrait
   * la représentation neutre.
   */
  public static parseManifest(
    markdown: string,
    fallback: { id: string; type: DiscoveryResourceType }
  ): SkillManifest {
    const { metadata, body } = extractFrontmatter(markdown);

    const rawTags: unknown = metadata.tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.map((t) => String(t))
      : typeof rawTags === 'string' && rawTags.length > 0
        ? rawTags.split(',').map((t: string) => t.trim()).filter(Boolean)
        : [];

    return {
      id: fallback.id,
      name: typeof metadata.name === 'string' && metadata.name.length > 0 ? metadata.name : fallback.id,
      description: typeof metadata.description === 'string' ? metadata.description : '',
      type: fallback.type,
      version: typeof metadata.version === 'string' ? metadata.version : undefined,
      tags,
      body,
      parameters: this.parseParameters(metadata.parameters),
    };
  }

  /**
   * Produit le manifeste au format attendu par l'agent cible. Les deux
   * dialectes partagent la structure SKILL.md ; ils divergent sur les clés de
   * frontmatter et sur la façon dont les instructions sont amenées au modèle.
   */
  public static toManifest(manifest: SkillManifest, runtime: AgentRuntime): string {
    const lines: string[] = ['---'];
    lines.push(`name: ${manifest.name}`);
    lines.push(`description: ${this.escapeFrontmatterValue(manifest.description)}`);
    if (manifest.version) {
      lines.push(`version: ${manifest.version}`);
    }
    if (manifest.tags.length > 0) {
      lines.push(`tags: [${manifest.tags.join(', ')}]`);
    }
    if (runtime === 'antigravity') {
      // Le gestionnaire de contexte Gemini s'appuie sur le type déclaré pour
      // décider du moment où la compétence entre dans la fenêtre de contexte.
      lines.push(`type: ${manifest.type}`);
    } else {
      // Claude Code expose les compétences comme commandes invocables.
      lines.push(`argument-hint: ${this.buildArgumentHint(manifest.parameters)}`);
    }
    lines.push('---');
    lines.push('');
    lines.push(manifest.body.trim());
    lines.push('');
    return lines.join('\n');
  }

  /**
   * Convertit la compétence en déclaration d'outil MCP, consommable par
   * Claude Code et par tout client compatible.
   */
  public static toMcpToolDeclaration(manifest: SkillManifest): McpToolDeclaration {
    const properties: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];

    for (const parameter of manifest.parameters) {
      properties[parameter.name] = {
        type: parameter.type,
        description: parameter.description,
      };
      if (parameter.required) {
        required.push(parameter.name);
      }
    }

    return {
      name: this.toToolName(manifest.id),
      description: manifest.description || manifest.name,
      inputSchema: {
        type: 'object',
        properties,
        required,
      },
    };
  }

  /**
   * Produit la commande slash correspondante, telle que Claude Code l'expose
   * à l'utilisateur.
   */
  public static toSlashCommand(manifest: SkillManifest): string {
    return `/${this.toToolName(manifest.id)}`;
  }

  /**
   * Reconstruit une compétence neutre à partir d'une déclaration d'outil MCP,
   * ce qui permet d'importer vers Anti-Gravity une ressource publiée pour
   * Claude Code.
   */
  public static fromMcpToolDeclaration(
    declaration: McpToolDeclaration,
    body: string,
    type: DiscoveryResourceType = 'skills'
  ): SkillManifest {
    const required = new Set(declaration.inputSchema?.required ?? []);
    const properties = declaration.inputSchema?.properties ?? {};

    return {
      id: declaration.name,
      name: declaration.name,
      description: declaration.description,
      type,
      tags: [],
      body,
      parameters: Object.entries(properties).map(([name, schema]) => ({
        name,
        type: this.normalizeParameterType(schema.type),
        description: schema.description ?? '',
        required: required.has(name),
      })),
    };
  }

  /**
   * Résout la destination d'un déploiement en fonction de l'agent actif, de la
   * cible demandée et du type de ressource.
   */
  public static resolveDeploymentPaths(options: {
    runtime: AgentRuntime;
    target: DeployTarget;
    type: DiscoveryResourceType;
    resourceId: string;
    workspaceRoot?: string | null;
    agentsDirName?: string | null;
    nasRoot?: string | null;
  }): DeploymentPaths {
    const { runtime, target, type, resourceId } = options;
    const baseDirectory = this.resolveBaseDirectory(options);
    const category = this.resolveCategoryFolder(type);

    // Les règles et les hooks sont des fichiers isolés ; les compétences et les
    // workflows occupent un dossier contenant leur manifeste et leurs annexes.
    if (type === 'rules' || type === 'hooks') {
      const directory = path.join(baseDirectory, category);
      const extension = type === 'hooks' && runtime === 'claude-code' ? '.md' : '.md';
      return {
        directory,
        file: path.join(directory, `${this.sanitizeId(resourceId)}${extension}`),
        isFolder: false,
      };
    }

    const directory = path.join(baseDirectory, category, this.sanitizeId(resourceId));
    return {
      directory,
      file: path.join(directory, 'SKILL.md'),
      isFolder: true,
    };
  }

  // ------------------------------------------------------------------
  // Mécanique interne
  // ------------------------------------------------------------------

  private static resolveBaseDirectory(options: {
    runtime: AgentRuntime;
    target: DeployTarget;
    workspaceRoot?: string | null;
    agentsDirName?: string | null;
    nasRoot?: string | null;
  }): string {
    const { runtime, target, workspaceRoot, agentsDirName, nasRoot } = options;

    if (target === 'nas') {
      if (!nasRoot) {
        throw new Error('Le chemin du répertoire NAS n’est pas configuré.');
      }
      return nasRoot;
    }

    if (target === 'global') {
      return runtime === 'claude-code'
        ? getEffectiveGlobalClaudePath()
        : getEffectiveGlobalAntigravityPath();
    }

    if (!workspaceRoot) {
      throw new Error('Aucun espace de travail n’est ouvert pour un déploiement local.');
    }

    const localFolder = runtime === 'claude-code' ? '.claude' : agentsDirName || '.agents';
    return path.join(workspaceRoot, localFolder);
  }

  private static resolveCategoryFolder(type: DiscoveryResourceType): string {
    switch (type) {
      case 'rules':
        return 'rules';
      case 'hooks':
        return 'hooks';
      case 'workflows':
      case 'skills':
      default:
        // Les workflows sont stockés avec les compétences, préfixés « wf- »,
        // conformément à la convention déjà en place dans le gestionnaire.
        return 'skills';
    }
  }

  private static parseParameters(raw: unknown): SkillParameter[] {
    if (!Array.isArray(raw)) return [];
    const parameters: SkillParameter[] = [];
    for (const entry of raw) {
      if (typeof entry === 'string') {
        // Forme compacte « nom:type:requis » tolérée dans les frontmatters.
        const [name, type, requiredFlag] = entry.split(':');
        if (!name) continue;
        parameters.push({
          name: name.trim(),
          type: this.normalizeParameterType(type),
          description: '',
          required: (requiredFlag || '').trim() === 'required',
        });
        continue;
      }
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        const name = typeof record.name === 'string' ? record.name : '';
        if (!name) continue;
        parameters.push({
          name,
          type: this.normalizeParameterType(record.type),
          description: typeof record.description === 'string' ? record.description : '',
          required: record.required === true,
        });
      }
    }
    return parameters;
  }

  private static normalizeParameterType(raw: unknown): SkillParameter['type'] {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    switch (value) {
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
      case 'bool':
        return 'boolean';
      case 'array':
        return 'array';
      case 'object':
        return 'object';
      default:
        return 'string';
    }
  }

  private static buildArgumentHint(parameters: SkillParameter[]): string {
    if (parameters.length === 0) return '[arguments]';
    return parameters
      .map((parameter) => (parameter.required ? `<${parameter.name}>` : `[${parameter.name}]`))
      .join(' ');
  }

  private static escapeFrontmatterValue(value: string): string {
    const singleLine = value.replace(/\r?\n/g, ' ').trim();
    // Une valeur contenant un deux-points suivi d'une espace casserait le YAML.
    return /:\s/.test(singleLine) ? `"${singleLine.replace(/"/g, '\\"')}"` : singleLine;
  }

  private static toToolName(id: string): string {
    return this.sanitizeId(id).toLowerCase();
  }

  private static sanitizeId(id: string): string {
    return (
      id
        .replace(/\.disabled$/i, '')
        .replace(/\.md$/i, '')
        // Les séparateurs de chemin et les caractères hors jeu deviennent des tirets.
        .replace(/[^A-Za-z0-9._-]/g, '-')
        // Toute séquence de points est neutralisée : un identifiant issu d'un
        // registre distant ne doit jamais pouvoir reconstituer un « .. ».
        .replace(/\.{2,}/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
    );
  }
}
