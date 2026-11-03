import { readdir, readFile, access } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';

const roots = [
  'README.md',
  'docs',
  'webhook-monitor/README.md',
  'webhook-monitor/docs',
  'parsed-streams-monitor/README.md',
  'parsed-streams-monitor/docs',
];
const files = [];
for (const root of roots) {
  if (extname(root) === '.md') files.push(root);
  else
    for (const name of await readdir(root))
      if (name.endsWith('.md')) files.push(`${root}/${name}`);
}
const failures = [];
for (const file of files) {
  const markdown = await readFile(file, 'utf8');
  for (const [, diagram] of markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
    if (/^[^\n]*:[^\n]*[;][^\n]*$/m.test(diagram))
      failures.push(`${file}: escape semicolons in Mermaid message text`);
  }
  const prose = markdown.replace(/```[\s\S]*?```/g, '');
  for (const [, target] of prose.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [path, anchor] = target.split('#');
    const destination = path ? resolve(dirname(file), path) : resolve(file);
    try {
      await access(destination);
      if (anchor && destination.endsWith('.md')) {
        const content = await readFile(destination, 'utf8');
        const anchors = [...content.matchAll(/^#{1,6} (.+)$/gm)].map(
          ([, heading]) =>
            heading
              .toLowerCase()
              .replace(/[^\p{L}\p{N}_ -]/gu, '')
              .replace(/ /g, '-'),
        );
        if (!anchors.includes(anchor))
          failures.push(`${file}: missing anchor ${target}`);
      }
    } catch {
      failures.push(`${file}: missing link ${target}`);
    }
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Documentation links and Mermaid message punctuation checked in ${files.length} files.`,
  );
