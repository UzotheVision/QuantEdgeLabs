/**
 * Phase 3 — design-system guardrails.
 *
 * TOKEN POLICY: color, spacing, type size, radius, and shadow values come
 * from the token store (CSS --* vars in client/src/index.css, re-exported
 * through client/src/lib/design-tokens.ts) — never from one-off arbitrary
 * Tailwind values. The no-restricted-syntax entries below fire on the three
 * most common drift vectors so new code can't quietly reintroduce magic
 * values:
 *   text-[<n>px]   -> use the type-scale classes (text-xs/sm/base/...)
 *   rounded-[<n>px]-> use the radius scale (rounded-sm/md/lg/xl/...)
 *   shadow-[...]   -> use the shadow scale (shadow-sm/md/lg/...)
 *
 * Severity is "warn": no lint step runs in CI or in `npm run build`
 * (vite build + esbuild only), so this config can never break the build.
 * Promote to "error" once eslint is wired into the pipeline.
 *
 * NOTE: eslint is not installed in this repo yet (no devDependency, no lint
 * script). To activate: `npm i -D eslint` then `npx eslint client/src`.
 * This config uses the default parser with JSX enabled; for full
 * TypeScript support add typescript-eslint and set it as the parser.
 */
export default [
  {
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            'JSXAttribute[name.name="className"] > Literal[value=/text-\\[\\d+(\\.\\d+)?px\\]/]',
          message:
            "Phase 3 tokens: arbitrary font size text-[Npx] is banned — use the type-scale classes (text-xs, text-sm, text-base, ...) instead.",
        },
        {
          selector:
            'CallExpression[callee.name=/^(cn|clsx|twMerge)$/] > Literal[value=/text-\\[\\d+(\\.\\d+)?px\\]/]',
          message:
            "Phase 3 tokens: arbitrary font size text-[Npx] is banned — use the type-scale classes (text-xs, text-sm, text-base, ...) instead.",
        },
        {
          selector:
            'JSXAttribute[name.name="className"] > Literal[value=/rounded-\\[\\d+(\\.\\d+)?(px|rem|em|%)?\\]/]',
          message:
            "Phase 3 tokens: arbitrary radius rounded-[Npx] is banned — use the radius scale (rounded-sm, rounded-md, rounded-lg, rounded-xl, ...) instead.",
        },
        {
          selector:
            'CallExpression[callee.name=/^(cn|clsx|twMerge)$/] > Literal[value=/rounded-\\[\\d+(\\.\\d+)?(px|rem|em|%)?\\]/]',
          message:
            "Phase 3 tokens: arbitrary radius rounded-[Npx] is banned — use the radius scale (rounded-sm, rounded-md, rounded-lg, rounded-xl, ...) instead.",
        },
        {
          selector:
            'JSXAttribute[name.name="className"] > Literal[value=/shadow-\\[[^\\]]+\\]/]',
          message:
            "Phase 3 tokens: arbitrary shadow shadow-[...] is banned — use the shadow scale (shadow-sm, shadow-md, shadow-lg, ...) or a token instead.",
        },
        {
          selector:
            'CallExpression[callee.name=/^(cn|clsx|twMerge)$/] > Literal[value=/shadow-\\[[^\\]]+\\]/]',
          message:
            "Phase 3 tokens: arbitrary shadow shadow-[...] is banned — use the shadow scale (shadow-sm, shadow-md, shadow-lg, ...) or a token instead.",
        },
      ],
    },
  },
];
