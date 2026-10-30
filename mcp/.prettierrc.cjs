// Match the personal pre-commit hook without changing upstream formatting rules.
module.exports = { ...require("../.prettierrc.js"), printWidth: 120 };
