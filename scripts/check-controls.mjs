import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/** Keep native buttons and dialog headers behind their shared component contracts. */
export function controlViolations(root) {
  const errors = [];
  function inspect(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const file = directory + '/' + entry.name;
      if (entry.isDirectory()) { inspect(file); continue; }
      if (!file.endsWith('.tsx')) continue;
      const source = ts.createSourceFile(file, readFileSync(join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node) {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          if (node.tagName.getText(source) === 'button' && file !== 'src/ui/Button.tsx') errors.push(`${file}:${line} 请使用 Button、IconButton 或 DismissButton`);
          const className = node.attributes.properties.find(attribute => attribute.name?.getText(source) === 'className');
          if (className?.getText(source).includes('btn-dismiss') && file !== 'src/ui/Button.tsx') errors.push(`${file}:${line} 关闭／返回／收起请使用 DismissButton`);
          if (className?.getText(source).includes('modal-header') && file !== 'src/ui/DialogHeader.tsx') errors.push(`${file}:${line} 弹窗标题栏请使用 DialogHeader`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  inspect('src');
  return errors;
}
