/** @type {import("prettier").Config} */
module.exports = {
  trailingComma: "all",
  arrowParens: "avoid",
  tabWidth: 2,
  useTabs: false,
  endOfLine: "auto",
  printWidth: 130,
  bracketSpacing: true,
  bracketSameLine: false,
  semi: true,
  singleQuote: false,
  // Keep fork integration files consistent with the personal pre-commit formatter.
  // Preserve upstream's width for files this fork has not changed.
  overrides: [
    {
      files: [
        "src/api/backup/Backup.ts",
        "src/api/parsers/macros.ts",
        "src/renderer/App.tsx",
        "src/renderer/views/LayoutEditor.tsx",
        "src/renderer/views/MacroEditor.tsx",
        "src/renderer/views/Preferences.tsx",
        "src/renderer/views/SuperkeysEditor.tsx",
      ],
      options: { printWidth: 120 },
    },
  ],
};
