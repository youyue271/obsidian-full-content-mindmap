import esbuild from 'esbuild';

const prod = process.argv[2] === 'production';

// Obsidian 从插件根目录加载 styles.css，这里把 src/styles.css 编译输出到根目录
const cssCtx = await esbuild.context({
  entryPoints: ['src/styles.css'],
  bundle: true,
  outfile: 'styles.css',
  logLevel: 'info',
  minify: prod,
});

const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
  ],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  minify: prod,
});

if (prod) {
  await Promise.all([ctx.rebuild(), cssCtx.rebuild()]);
  process.exit(0);
} else {
  await Promise.all([ctx.watch(), cssCtx.watch()]);
}
