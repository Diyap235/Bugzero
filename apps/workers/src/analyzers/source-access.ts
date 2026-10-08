export interface SourceMetadata {
  path: string;
  exists: boolean;
  language?: string;
  lineCount: number;
  hash?: string;
}

export interface SourceAccess {
  getFileContent(filePath: string): Promise<string> | string;
  getLineRange(filePath: string, startLine: number, endLine: number): Promise<string[]> | string[];
  getSourceMetadata(filePath: string): Promise<SourceMetadata> | SourceMetadata;
}

export class InMemorySourceAccess implements SourceAccess {
  constructor(private readonly files: Map<string, string> = new Map()) {}

  setFile(filePath: string, content: string): void {
    this.files.set(filePath.replace(/\\/g, '/'), content);
  }

  getFileContent(filePath: string): string {
    return this.files.get(filePath.replace(/\\/g, '/')) ?? '';
  }

  getLineRange(filePath: string, startLine: number, endLine: number): string[] {
    if (startLine < 1 || endLine < startLine) {
      return [];
    }

    const content = this.getFileContent(filePath);
    const lines = content.split(/\r\n|\r|\n/);
    return lines.slice(startLine - 1, endLine).filter((_, index) => index < endLine - startLine + 1);
  }

  getSourceMetadata(filePath: string): SourceMetadata {
    const content = this.getFileContent(filePath);
    const lineCount = content.length === 0 ? 0 : content.split(/\r\n|\r|\n/).length;
    const extension = filePath.split('.').pop()?.toLowerCase();
    const language = extension === 'py' ? 'Python'
      : extension === 'js' || extension === 'jsx' ? 'JavaScript'
        : extension === 'ts' || extension === 'tsx' ? 'TypeScript'
          : undefined;
    return {
      path: filePath.replace(/\\/g, '/'),
      exists: this.files.has(filePath.replace(/\\/g, '/')),
      lineCount,
      language,
    };
  }
}
