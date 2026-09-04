// packages/core/command-analyzer.ts
import { basename, resolve as resolve2 } from "path";
import { homedir as homedir2 } from "os";

// packages/core/path-validator.ts
import { resolve, relative, join } from "path";
import { homedir } from "os";
import { realpathSync, readdirSync, lstatSync } from "fs";

// packages/core/constants.ts
var DANGEROUS_COMMANDS = /* @__PURE__ */ new Set([
  "rm",
  "rmdir",
  "unlink",
  "shred",
  "mv",
  "cp",
  "chmod",
  "chown",
  "chgrp",
  "truncate",
  "dd",
  "ln"
]);
var DANGEROUS_PATTERNS = [
  { pattern: /\bfind\b.*\s-delete\b/, name: "find -delete" },
  { pattern: /\bfind\b.*-exec\s+(rm|mv|cp)\b/, name: "find -exec" },
  { pattern: /\bxargs\s+(-[^\s]+\s+)*(rm|mv|cp)\b/, name: "xargs" },
  { pattern: /\brsync\b.*--delete\b/, name: "rsync --delete" }
];
var REDIRECT_PATTERN = /\d*>{1,2}\s*/g;
var DEVICE_PATHS = ["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"];
var PLATFORM_PATHS = [
  ".claude",
  ".factory",
  ".pi",
  ".config/opencode"
];
var TEMP_PATHS = [
  "/tmp",
  "/var/tmp",
  "/private/tmp",
  "/private/var/tmp"
];
var SAFE_WRITE_PATHS = [...DEVICE_PATHS, ...TEMP_PATHS];
var PROTECTED_PATTERNS = [
  { pattern: /^\.env($|\.(?!example$).+)/, name: ".env files" },
  { pattern: /^\.git(\/|$)/, name: ".git directory" },
  { pattern: /^\.leashrc$/, name: ".leashrc config" }
];
var ALWAYS_BLOCKED_PATTERNS = [
  // Git — can destroy uncommitted work or remote history
  { pattern: /\bgit\s+checkout\b.*\s--\s/, name: "git checkout --" },
  { pattern: /\bgit\s+restore\s+(?!--staged)/, name: "git restore" },
  { pattern: /\bgit\s+reset\s+.*--hard\b/, name: "git reset --hard" },
  { pattern: /\bgit\s+reset\s+.*--merge\b/, name: "git reset --merge" },
  {
    pattern: /\bgit\s+clean\s+.*(-[a-zA-Z]*f[a-zA-Z]*|--force)\b/,
    name: "git clean --force"
  },
  { pattern: /\bgit\s+push\s+.*(-f|--force)\b/, name: "git push --force" },
  { pattern: /\bgit\s+branch\s+.*-D\b/, name: "git branch -D" },
  { pattern: /\bgit\s+stash\s+drop\b/, name: "git stash drop" },
  { pattern: /\bgit\s+stash\s+clear\b/, name: "git stash clear" },
  // Github CLI (gh)
  { pattern: /\bgh\s+auth\b/, name: "gh auth" },
  { pattern: /\bgh\s+codespace\b/, name: "gh codespace" },
  { pattern: /\bgh\s+issue delete\b/, name: "gh issue delete" },
  { pattern: /\bgh\s+pr close\b/, name: "gh pr close" },
  { pattern: /\bgh\s+pr lock\b/, name: "gh pr lock" },
  { pattern: /\bgh\s+pr unlock\b/, name: "gh pr unlock" },
  { pattern: /\bgh\s+pr merge\b/, name: "gh pr merge" },
  { pattern: /\bgh\s+project\b/, name: "gh project" },
  { pattern: /\bgh\s+release delete\b/, name: "gh release delete" },
  { pattern: /\bgh\s+repo create\b/, name: "gh repo create" },
  { pattern: /\bgh\s+repo delete\b/, name: "gh repo delete" },
  { pattern: /\bgh\s+repo deploy-key\b/, name: "gh repo deploy-key" },
  { pattern: /\bgh\s+repo fork\b/, name: "gh repo fork" },
  { pattern: /\bgh\s+run delete\b/, name: "gh run delete" },
  { pattern: /\bgh\s+workflow disable\b/, name: "gh workflow disable" },
  { pattern: /\bgh\s+agent-task\b/, name: "gh agent-task" },
  // Block gh api except read-only endpoints we trust: graphql and code
  // search. Endpoint stays anchored right after `gh api` (an optional
  // `-X GET` may precede it) so a dangerous endpoint can't ride through
  // by appearing later in the command. The search/code token must end at
  // a query string, whitespace, or end-of-command — forbidding a trailing
  // `/` stops path traversal (`search/code/../../repos/x`) from walking to
  // another endpoint. Endpoint-first form always works.
  {
    pattern: /\bgh\s+api (?!(?:graphql\b|(?:-X GET\s+)?\/?search\/code(?=[?\s]|$)))/,
    name: "gh api (not graphql/search-code)"
  },
  { pattern: /\bgh\s+attestation\b/, name: "gh attestation" },
  { pattern: /\bgh\s+copilot\b/, name: "gh copilot" },
  { pattern: /\bgh\s+gpg-keys\b/, name: "gh gpg-keys" },
  { pattern: /\bgh\s+label delete\b/, name: "gh label delete" },
  { pattern: /\bgh\s+secret\b/, name: "gh secret" },
  { pattern: /\bgh\s+ssh-key\b/, name: "gh ssh-key" },
  // System — always dangerous regardless of path
  { pattern: /\bmkfs(\.\w+)?\s+\/dev\//, name: "mkfs" },
  {
    pattern: /(\w+|:)\(\)\s*\{[^}]*\1\s*\|\s*\1[^}]*&/,
    name: "fork bomb (recursive)"
  },
  {
    pattern: /while\s+(true|:|1)\b.*\bdo\b.*;?\s*\b(bash|sh|zsh)\b.*&.*\bdone\b/,
    name: "fork bomb (loop)"
  },
  { pattern: /\b(curl|wget)\b.+\|\s*(ba)?sh\b/, name: "pipe to shell" },
  { pattern: /\beval\b.+\$\(.*(curl|wget)\b/, name: "eval remote code" },
  {
    pattern: /\bdocker\s+volume\s+(rm|prune)\b/,
    name: "docker volume rm/prune"
  },
  { pattern: /\bcrontab\s+-r\b/, name: "crontab -r" },
  { pattern: /\bchmod\b.*\b777\b/, name: "chmod 777" },
  // Leash CLI — agent must not modify its own guardrails
  {
    pattern: /\bleash\s+(setup|remove|revoke|list|update|path)\b/,
    name: "leash CLI"
  },
  {
    pattern: /\bleash\s+allow\s+.*[\/.]/,
    name: "leash allow with path"
  }
];

// packages/core/path-validator.ts
var PathValidator = class {
  constructor(workingDirectory, allowedDirectories = []) {
    this.workingDirectory = workingDirectory;
    this.allowedDirectories = allowedDirectories;
  }
  workingDirectory;
  allowedDirectories;
  expand(path) {
    return path.replace(/^~(?=\/|$)/, homedir()).replace(/\$\{?(\w+)\}?/g, (_, name) => {
      if (name === "HOME") return homedir();
      if (name === "PWD") return this.workingDirectory;
      return process.env[name] || "";
    });
  }
  resolveReal(path) {
    const expanded = this.expand(path);
    const resolved = resolve(this.workingDirectory, expanded);
    try {
      return realpathSync(resolved);
    } catch {
      return resolved;
    }
  }
  isWithinDir(realPath, dir) {
    try {
      const realDir = realpathSync(dir);
      if (realPath === realDir) {
        return true;
      }
      const rel = relative(realDir, realPath);
      return !!rel && !rel.startsWith("..") && !rel.startsWith("/");
    } catch {
      return false;
    }
  }
  isWithinAllowedDir(path) {
    const realPath = this.resolveReal(path);
    if (this.isWithinDir(realPath, this.workingDirectory)) return true;
    for (const dir of this.allowedDirectories) {
      if (this.isWithinDir(realPath, dir)) return true;
    }
    return false;
  }
  matchesAny(resolved, paths) {
    return paths.some((p) => resolved === p || resolved.startsWith(p + "/"));
  }
  isSafeForWrite(path) {
    const resolved = this.resolveReal(path);
    return this.matchesAny(resolved, SAFE_WRITE_PATHS);
  }
  isTempPath(path) {
    const resolved = this.resolveReal(path);
    return this.matchesAny(resolved, TEMP_PATHS);
  }
  isPlatformPath(path) {
    const resolved = this.resolveReal(path);
    const home = homedir();
    const platformPaths = PLATFORM_PATHS.map((p) => `${home}/${p}`);
    return this.matchesAny(resolved, platformPaths);
  }
  isProtectedPath(path) {
    if (!this.isWithinAllowedDir(path)) {
      return { protected: false };
    }
    const realPath = this.resolveReal(path);
    const dirsToCheck = [this.workingDirectory, ...this.allowedDirectories];
    for (const dir of dirsToCheck) {
      try {
        const realDir = realpathSync(dir);
        const relativePath = relative(realDir, realPath);
        if (!relativePath || relativePath.startsWith("..") || relativePath.startsWith("/")) {
          continue;
        }
        for (const { pattern, name } of PROTECTED_PATTERNS) {
          if (pattern.test(relativePath)) {
            return { protected: true, name };
          }
        }
      } catch {
        continue;
      }
    }
    return { protected: false };
  }
  suggestAllowableSymlink(blockedPath) {
    try {
      const realPath = this.resolveReal(blockedPath);
      const entries = readdirSync(this.workingDirectory);
      for (const entry of entries) {
        const entryPath = join(this.workingDirectory, entry);
        try {
          if (!lstatSync(entryPath).isSymbolicLink()) continue;
          const target = realpathSync(entryPath);
          if (this.isWithinDir(realPath, target)) return entry;
        } catch {
          continue;
        }
      }
    } catch {
    }
    return null;
  }
};

// packages/core/command-analyzer.ts
var DELETE_COMMANDS = /* @__PURE__ */ new Set(["rm", "rmdir", "unlink", "shred"]);
var CommandAnalyzer = class {
  constructor(workingDirectory, allowedDirectories = []) {
    this.workingDirectory = workingDirectory;
    this.pathValidator = new PathValidator(workingDirectory, allowedDirectories);
  }
  workingDirectory;
  pathValidator;
  suggestAllow(blockedPath) {
    return this.pathValidator.suggestAllowableSymlink(blockedPath);
  }
  resolvePath(path, resolveBase) {
    const expanded = this.pathValidator.expand(path);
    return resolveBase ? resolve2(resolveBase, expanded) : expanded;
  }
  /**
   * Strip heredoc content from command before analyzing redirects.
   * Handles: <<EOF, <<'EOF', <<"EOF", <<-EOF
   */
  stripHeredocs(command) {
    const heredocStart = /<<-?\s*(['"]?)(\w+)\1/g;
    let result = command;
    let match;
    while ((match = heredocStart.exec(command)) !== null) {
      const delimiter = match[2];
      const endPattern = new RegExp(`\\n\\t*${delimiter}\\s*(?:\\n|$)`);
      const startIndex = match.index;
      const contentAfterStart = command.slice(match.index + match[0].length);
      const endMatch = endPattern.exec(contentAfterStart);
      if (endMatch) {
        const endIndex = match.index + match[0].length + endMatch.index + endMatch[0].length;
        result = result.slice(0, startIndex) + result.slice(endIndex);
      }
    }
    return result;
  }
  isPathAllowed(path, allowDevicePaths, resolveBase) {
    const resolved = this.resolvePath(path, resolveBase);
    if (this.pathValidator.isWithinAllowedDir(resolved)) return true;
    if (this.pathValidator.isPlatformPath(resolved)) return true;
    return allowDevicePaths ? this.pathValidator.isSafeForWrite(resolved) : this.pathValidator.isTempPath(resolved);
  }
  checkProtectedPath(path, context, resolveBase) {
    const resolved = this.resolvePath(path, resolveBase);
    const protection = this.pathValidator.isProtectedPath(resolved);
    if (protection.protected) {
      return {
        blocked: true,
        reason: `${context} targets protected path: ${protection.name}`
      };
    }
    return { blocked: false };
  }
  extractPaths(command) {
    const paths = [];
    const quoted = command.match(/["']([^"']+)["']/g) || [];
    quoted.forEach((q) => paths.push(q.slice(1, -1)));
    const tokens = command.replace(/["'][^"']*["']/g, "").split(/\s+/).filter((t) => !t.startsWith("-"));
    for (let i = 1; i < tokens.length; i++) {
      const value = tokens[i].includes("=") ? tokens[i].split("=").slice(1).join("=") : tokens[i];
      if (value) paths.push(value);
    }
    return paths;
  }
  getBaseCommand(command) {
    const tokens = command.trim().split(/\s+/);
    if (tokens.length === 0) return "";
    const first = tokens[0];
    let i = 0;
    if (first === "sudo" || first === "command") {
      i++;
      while (i < tokens.length) {
        const token = tokens[i];
        if (token === "--") {
          i++;
          break;
        }
        if (token.startsWith("-")) {
          i++;
          continue;
        }
        break;
      }
      return basename(tokens[i] || "");
    }
    if (first === "env") {
      const optsWithArgs = /* @__PURE__ */ new Set([
        "-u",
        "-C",
        "-S",
        "--unset",
        "--chdir",
        "--split-string"
      ]);
      i++;
      while (i < tokens.length) {
        const token = tokens[i];
        if (token === "--") {
          i++;
          break;
        }
        if (optsWithArgs.has(token)) {
          i += 2;
          continue;
        }
        if (token.startsWith("-") || token.includes("=")) {
          i++;
          continue;
        }
        break;
      }
      return basename(tokens[i] || "");
    }
    return basename(tokens[0] || "");
  }
  splitCommands(command) {
    const commands = [];
    let current = "";
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let i = 0;
    while (i < command.length) {
      const char = command[i];
      const nextChar = command[i + 1];
      if (char === "\\" && !inSingleQuote) {
        current += char + (nextChar || "");
        i += 2;
        continue;
      }
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        current += char;
        i++;
        continue;
      }
      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        current += char;
        i++;
        continue;
      }
      if (!inSingleQuote && !inDoubleQuote) {
        if (char === "&" && nextChar === "&" || char === "|" && nextChar === "|") {
          if (current.trim()) commands.push(current.trim());
          current = "";
          i += 2;
          continue;
        }
        if (char === ";" || char === "|" && nextChar !== "|") {
          if (current.trim()) commands.push(current.trim());
          current = "";
          i++;
          continue;
        }
      }
      current += char;
      i++;
    }
    if (current.trim()) commands.push(current.trim());
    return commands;
  }
  extractRedirectPath(command, start) {
    let path = "";
    let quote = null;
    let dynamic = false;
    for (let i = start; i < command.length; i++) {
      const char = command[i];
      if (char === "\\" && quote !== "'") {
        const nextChar = command[++i];
        if (nextChar) path += nextChar;
        continue;
      }
      if (quote) {
        if (char === quote) {
          quote = null;
        } else {
          if (char === "$" && quote !== "'") dynamic = true;
          path += char;
        }
        continue;
      }
      if (char === "'" || char === '"') {
        quote = char;
      } else if (/\s/.test(char) || ";|&()<>".includes(char)) {
        break;
      } else {
        if (char === "$") dynamic = true;
        path += char;
      }
    }
    return path ? { path, dynamic } : null;
  }
  checkRedirects(command) {
    const strippedCommand = this.stripHeredocs(command);
    const matches = strippedCommand.matchAll(REDIRECT_PATTERN);
    for (const match of matches) {
      const redirect = this.extractRedirectPath(
        strippedCommand,
        match.index + match[0].length
      );
      if (!redirect) continue;
      if (redirect.dynamic) {
        return {
          blocked: true,
          reason: "Redirect target contains shell expansion"
        };
      }
      const { path } = redirect;
      if (!this.pathValidator.isSafeForWrite(path) && !this.pathValidator.isWithinAllowedDir(path) && !this.pathValidator.isPlatformPath(path)) {
        return {
          blocked: true,
          reason: `Redirect to path outside working directory: ${path}`
        };
      }
      const result = this.checkProtectedPath(path, "Redirect");
      if (result.blocked) return result;
    }
    return { blocked: false };
  }
  isCdCommand(command) {
    return this.getBaseCommand(command) === "cd";
  }
  extractCdTarget(command) {
    const trimmed = command.trim();
    const quotedMatch = trimmed.match(/^cd\s+["']([^"']+)["']/);
    if (quotedMatch) return quotedMatch[1];
    const tokens = trimmed.split(/\s+/);
    if (tokens[0] !== "cd") return null;
    if (tokens.length === 1) return homedir2();
    let i = 1;
    while (i < tokens.length && tokens[i].startsWith("-")) {
      i++;
    }
    return tokens[i] || null;
  }
  checkAlwaysBlockedPatterns(command) {
    for (const { pattern, name } of ALWAYS_BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return {
          blocked: true,
          reason: `Dangerous command blocked: ${name}`
        };
      }
    }
    return { blocked: false };
  }
  checkDangerousPatterns(command, resolveBase) {
    for (const { pattern, name } of DANGEROUS_PATTERNS) {
      if (!pattern.test(command)) continue;
      const paths = this.extractPaths(command);
      for (const path of paths) {
        const resolved = this.resolvePath(path, resolveBase);
        if (!this.pathValidator.isWithinAllowedDir(resolved) && !this.pathValidator.isTempPath(resolved) && !this.pathValidator.isPlatformPath(resolved)) {
          return {
            blocked: true,
            reason: `Command "${name}" targets path outside working directory: ${path}`
          };
        }
        const result = this.checkProtectedPath(
          path,
          `Command "${name}"`,
          resolveBase
        );
        if (result.blocked) return result;
      }
    }
    return { blocked: false };
  }
  checkCpCommand(paths, resolveBase) {
    if (paths.length === 0) return { blocked: false };
    const dest = paths[paths.length - 1];
    if (!this.isPathAllowed(dest, true, resolveBase)) {
      return {
        blocked: true,
        reason: `Command "cp" targets path outside working directory: ${this.resolvePath(
          dest,
          resolveBase
        )}`
      };
    }
    return this.checkProtectedPath(dest, 'Command "cp"', resolveBase);
  }
  checkDdCommand(command, resolveBase) {
    const ofMatch = command.match(/\bof=["']?([^"'\s]+)["']?/);
    if (!ofMatch) return { blocked: false };
    const dest = ofMatch[1];
    if (!this.isPathAllowed(dest, true, resolveBase)) {
      return {
        blocked: true,
        reason: `Command "dd" targets path outside working directory: ${this.resolvePath(
          dest,
          resolveBase
        )}`
      };
    }
    return this.checkProtectedPath(dest, 'Command "dd"', resolveBase);
  }
  checkMvCommand(paths, resolveBase) {
    if (paths.length === 0) return { blocked: false };
    const dest = paths[paths.length - 1];
    const sources = paths.slice(0, -1);
    if (!this.isPathAllowed(dest, true, resolveBase)) {
      return {
        blocked: true,
        reason: `Command "mv" targets path outside working directory: ${this.resolvePath(
          dest,
          resolveBase
        )}`
      };
    }
    const destResult = this.checkProtectedPath(
      dest,
      'Command "mv"',
      resolveBase
    );
    if (destResult.blocked) return destResult;
    for (const source of sources) {
      if (!this.isPathAllowed(source, false, resolveBase)) {
        return {
          blocked: true,
          reason: `Command "mv" targets path outside working directory: ${this.resolvePath(
            source,
            resolveBase
          )}`
        };
      }
      const sourceResult = this.checkProtectedPath(
        source,
        'Command "mv"',
        resolveBase
      );
      if (sourceResult.blocked) return sourceResult;
    }
    return { blocked: false };
  }
  checkDeleteCommand(baseCmd, paths, resolveBase) {
    for (const path of paths) {
      if (!this.isPathAllowed(path, false, resolveBase)) {
        return {
          blocked: true,
          reason: `Command "${baseCmd}" targets path outside working directory: ${this.resolvePath(
            path,
            resolveBase
          )}`
        };
      }
      const result = this.checkProtectedPath(
        path,
        `Command "${baseCmd}"`,
        resolveBase
      );
      if (result.blocked) return result;
    }
    return { blocked: false };
  }
  checkWriteCommand(baseCmd, paths, resolveBase) {
    const allowDevicePaths = baseCmd === "truncate";
    for (const path of paths) {
      if (!this.isPathAllowed(path, allowDevicePaths, resolveBase)) {
        return {
          blocked: true,
          reason: `Command "${baseCmd}" targets path outside working directory: ${this.resolvePath(
            path,
            resolveBase
          )}`
        };
      }
      const result = this.checkProtectedPath(
        path,
        `Command "${baseCmd}"`,
        resolveBase
      );
      if (result.blocked) return result;
    }
    return { blocked: false };
  }
  checkDangerousCommand(command, resolveBase) {
    const baseCmd = this.getBaseCommand(command);
    if (!DANGEROUS_COMMANDS.has(baseCmd)) {
      return { blocked: false };
    }
    const paths = this.extractPaths(command);
    if (baseCmd === "cp") return this.checkCpCommand(paths, resolveBase);
    if (baseCmd === "dd") return this.checkDdCommand(command, resolveBase);
    if (baseCmd === "mv") return this.checkMvCommand(paths, resolveBase);
    if (DELETE_COMMANDS.has(baseCmd))
      return this.checkDeleteCommand(baseCmd, paths, resolveBase);
    return this.checkWriteCommand(baseCmd, paths, resolveBase);
  }
  analyze(command) {
    const gitResult = this.checkAlwaysBlockedPatterns(command);
    if (gitResult.blocked) return gitResult;
    const redirectResult = this.checkRedirects(command);
    if (redirectResult.blocked) return redirectResult;
    const commands = this.splitCommands(command);
    const hasCd = commands.some((cmd) => this.isCdCommand(cmd.trim()));
    if (!hasCd) {
      const patternResult = this.checkDangerousPatterns(command);
      if (patternResult.blocked) return patternResult;
    }
    let currentWorkDir = this.workingDirectory;
    for (const cmd of commands) {
      const trimmed = cmd.trim();
      if (!trimmed) continue;
      if (this.isCdCommand(trimmed)) {
        const target = this.extractCdTarget(trimmed);
        if (target) {
          const expanded = this.pathValidator.expand(target);
          currentWorkDir = resolve2(currentWorkDir, expanded);
        }
        continue;
      }
      const resolveBase = currentWorkDir !== this.workingDirectory ? currentWorkDir : void 0;
      if (hasCd) {
        const patternResult = this.checkDangerousPatterns(trimmed, resolveBase);
        if (patternResult.blocked) return patternResult;
      }
      const result = this.checkDangerousCommand(trimmed, resolveBase);
      if (result.blocked) return result;
    }
    return { blocked: false };
  }
  validatePath(path) {
    if (!path) return { blocked: false };
    if (!this.pathValidator.isSafeForWrite(path) && !this.pathValidator.isWithinAllowedDir(path) && !this.pathValidator.isPlatformPath(path)) {
      return {
        blocked: true,
        reason: `File operation targets path outside working directory: ${path}`
      };
    }
    return this.checkProtectedPath(path, "File operation");
  }
};

// packages/core/version-checker.ts
import { readFileSync, existsSync } from "fs";
import { dirname, join as join2 } from "path";
import { fileURLToPath } from "url";
function getVersion() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join2(__dirname, "..", "..", "package.json"),
    join2(__dirname, "..", "..", "..", "package.json")
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const pkg = JSON.parse(readFileSync(path, "utf-8"));
        if (pkg.name === "@sailthru/leash") {
          return pkg.version;
        }
      } catch {
      }
    }
  }
  return "0.0.0";
}
var CURRENT_VERSION = getVersion();
var VERSION_URL = "https://raw.githubusercontent.com/sailthru/leash/main/package.json";
function parseVersionPart(part) {
  return parseInt(part.split(/[-_]/)[0], 10) || 0;
}
function isNewerVersion(latest, current) {
  const latestParts = latest.split(".").map(parseVersionPart);
  const currentParts = current.split(".").map(parseVersionPart);
  const len = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < len; i++) {
    const l = latestParts[i] ?? 0;
    const c = currentParts[i] ?? 0;
    if (l !== c) return l > c;
  }
  return false;
}
async function checkForUpdates() {
  try {
    const response = await fetch(VERSION_URL);
    if (!response.ok) {
      return { hasUpdate: false, currentVersion: CURRENT_VERSION };
    }
    const data = await response.json();
    return {
      hasUpdate: isNewerVersion(data.version, CURRENT_VERSION),
      latestVersion: data.version,
      currentVersion: CURRENT_VERSION
    };
  } catch {
    return { hasUpdate: false, currentVersion: CURRENT_VERSION };
  }
}

// packages/core/leashrc.ts
import { join as join3 } from "path";
import { readFileSync as readFileSync2, lstatSync as lstatSync2 } from "fs";
function parseLeashrc(content) {
  const allow = [];
  let currentSection = "";
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[(\w+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      continue;
    }
    if (currentSection === "allow") {
      allow.push(line);
    }
  }
  return { allow };
}
function readLeashrc(cwd) {
  const filePath = join3(cwd, ".leashrc");
  try {
    if (lstatSync2(filePath).isSymbolicLink()) return { allow: [] };
    const content = readFileSync2(filePath, "utf-8");
    return parseLeashrc(content);
  } catch {
    return { allow: [] };
  }
}

// packages/pi/leash.ts
function leash_default(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("\u{1F512} Leash active", "info");
    ctx.ui.setStatus("leash", "\u{1F512} Leash active");
    const update = await checkForUpdates();
    if (update.hasUpdate) {
      ctx.ui.notify(
        `\u{1F504} Leash ${update.latestVersion} available. Run: leash update (restart required)`,
        "warning"
      );
    }
  });
  pi.on("tool_call", async (event, ctx) => {
    const { allow } = readLeashrc(ctx.cwd);
    const analyzer = new CommandAnalyzer(ctx.cwd, allow);
    if (event.toolName === "bash") {
      const command = event.input.command || "";
      const result = analyzer.analyze(command);
      if (result.blocked) {
        if (ctx.hasUI) {
          ctx.ui.notify(`\u{1F6AB} Command blocked: ${result.reason}`, "warning");
        }
        return {
          block: true,
          reason: `Command blocked: ${command}
Reason: ${result.reason}
Working directory: ${ctx.cwd}
Action: Guide the user to run the command manually.`
        };
      }
    }
    if (event.toolName === "write" || event.toolName === "edit") {
      const path = event.input.path || "";
      const result = analyzer.validatePath(path);
      if (result.blocked) {
        const suggestion = analyzer.suggestAllow(path);
        let reason = `File operation blocked: ${path}
Reason: ${result.reason}
Working directory: ${ctx.cwd}
`;
        if (suggestion) {
          reason += `Hint: This path is reachable via symlink "${suggestion}" in your working directory.
      Run: leash allow ${suggestion}
`;
        }
        reason += `Action: Guide the user to perform this operation manually.`;
        if (ctx.hasUI) {
          ctx.ui.notify(`\u{1F6AB} File operation blocked: ${result.reason}`, "warning");
        }
        return { block: true, reason };
      }
    }
    return void 0;
  });
}
export {
  leash_default as default
};
