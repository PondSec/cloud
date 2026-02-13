import fs from 'node:fs/promises';
import path from 'node:path';

import type { WorkspaceSettings } from '../types.js';

type TemplateName = 'python' | 'node-ts' | 'c' | 'web';

function defaultLanguageServers(overrides: Partial<Record<string, boolean>> = {}): Record<string, boolean> {
  return {
    typescript: true,
    javascript: true,
    python: true,
    c: true,
    cpp: true,
    html: true,
    css: true,
    json: true,
    yaml: true,
    bash: true,
    dockerfile: true,
    php: true,
    sql: true,
    go: false,
    rust: false,
    lua: false,
    java: false,
    ...overrides,
  };
}

export function templateDefaults(template: string): WorkspaceSettings {
  switch (template as TemplateName) {
    case 'python':
      return {
        env: {},
        commands: {
          run: 'python3 main.py',
          test: 'python3 -m pytest -q',
          build: '',
          preview: 'python3 -m http.server 3000',
        },
        previewPort: 3000,
        languageServers: defaultLanguageServers({ typescript: false }),
        allowEgress: true,
      };
    case 'node-ts':
      return {
        env: {},
        commands: {
          run: 'npm run dev',
          build: 'npm run build',
          test: 'npm test',
          preview: 'npm run dev -- --host 0.0.0.0 --port 3000',
        },
        previewPort: 3000,
        languageServers: defaultLanguageServers({ python: false }),
        allowEgress: true,
      };
    case 'c':
      return {
        env: {},
        commands: {
          run: 'gcc -Wall -Wextra -o app main.c && ./app',
          build: 'gcc -Wall -Wextra -o app main.c',
          test: './app',
          preview: '',
        },
        previewPort: 0,
        languageServers: defaultLanguageServers({ typescript: false, python: false }),
        allowEgress: false,
      };
    case 'web':
    default:
      return {
        env: {},
        commands: {
          run: 'python3 -m http.server 3000',
          build: '',
          test: '',
          preview: 'python3 -m http.server 3000',
        },
        previewPort: 3000,
        languageServers: defaultLanguageServers({ python: false }),
        allowEgress: true,
      };
  }
}

export async function scaffoldTemplate(rootDir: string, template: string): Promise<void> {
  await fs.mkdir(rootDir, { recursive: true });

  switch (template as TemplateName) {
    case 'python':
      await writeFiles(rootDir, {
        'main.py': 'print("Hello from Cloud IDE Python template")\n',
        'README.md': '# Python Workspace\n\nRun with `python3 main.py`.\n',
        '.cloudide.json': JSON.stringify(templateDefaults('python'), null, 2),
      });
      return;
    case 'node-ts':
      await writeFiles(rootDir, {
        'package.json': JSON.stringify(
          {
            name: 'cloudide-node-template',
            private: true,
            scripts: {
              dev: 'node server.js',
              build: 'echo "build placeholder"',
              test: 'node -e "console.log(\'no tests\')"',
            },
          },
          null,
          2,
        ),
        'server.js': "const http = require('http');\nconst port = process.env.PORT || 3000;\nhttp.createServer((_, res) => res.end('Hello Node template')).listen(port, '0.0.0.0');\n",
        'index.ts': "export const hello = 'Hello TypeScript';\n",
        '.cloudide.json': JSON.stringify(templateDefaults('node-ts'), null, 2),
      });
      return;
    case 'c':
      await writeFiles(rootDir, {
        'main.c': '#include <stdio.h>\n\nint main(void) {\n  printf("Hello from C template\\n");\n  return 0;\n}\n',
        '.cloudide.json': JSON.stringify(templateDefaults('c'), null, 2),
      });
      return;
    case 'web':
    default:
      await writeFiles(rootDir, {
        'index.html': '<!doctype html><html><head><meta charset="UTF-8"><title>Cloud IDE</title></head><body><h1>Hello Web Template</h1><script src="app.js"></script></body></html>',
        'app.js': "document.body.insertAdjacentHTML('beforeend', '<p>Live preview ready.</p>');\n",
        '.cloudide.json': JSON.stringify(templateDefaults('web'), null, 2),
      });
  }
}

async function writeFiles(rootDir: string, files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([relative, content]) => {
      const target = path.join(rootDir, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf8');
    }),
  );
}
