export const DANGEROUS_COMMANDS = new Set([
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
  "ln",
]);

export const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bfind\b.*\s-delete\b/, name: "find -delete" },
  { pattern: /\bfind\b.*-exec\s+(rm|mv|cp)\b/, name: "find -exec" },
  { pattern: /\bxargs\s+(-[^\s]+\s+)*(rm|mv|cp)\b/, name: "xargs" },
  { pattern: /\brsync\b.*--delete\b/, name: "rsync --delete" },
];

export const REDIRECT_PATTERN = /\d*>{1,2}\s*/g;

const DEVICE_PATHS = ["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"];

export const PLATFORM_PATHS = [
  ".claude",
  ".factory",
  ".pi",
  ".config/opencode",
];

export const TEMP_PATHS = [
  "/tmp",
  "/var/tmp",
  "/private/tmp",
  "/private/var/tmp",
];

export const SAFE_WRITE_PATHS = [...DEVICE_PATHS, ...TEMP_PATHS];

/** Protected paths within working directory - blocks write and delete operations */
export const PROTECTED_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /^\.env($|\.(?!example$).+)/, name: ".env files" },
  { pattern: /^\.git(\/|$)/, name: ".git directory" },
  { pattern: /^\.leashrc$/, name: ".leashrc config" },
];

/** Blocked even within working directory - unconditionally dangerous commands */
export const ALWAYS_BLOCKED_PATTERNS: Array<{ pattern: RegExp; name: string }> =
  [
    // Git — can destroy uncommitted work or remote history
    { pattern: /\bgit\s+checkout\b.*\s--\s/, name: "git checkout --" },
    { pattern: /\bgit\s+restore\s+(?!--staged)/, name: "git restore" },
    { pattern: /\bgit\s+reset\s+.*--hard\b/, name: "git reset --hard" },
    { pattern: /\bgit\s+reset\s+.*--merge\b/, name: "git reset --merge" },
    {
      pattern: /\bgit\s+clean\s+.*(-[a-zA-Z]*f[a-zA-Z]*|--force)\b/,
      name: "git clean --force",
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
    // by appearing later in the command. Both allowed endpoints must be
    // followed only by whitespace (or a query string for search/code) —
    // forbidding a trailing `/` stops path traversal (`graphql/../repos/x`,
    // `search/code/../repos/x`) from walking to another endpoint, and it
    // rejects the useless bare search/code call. Endpoint-first always works.
    {
      pattern:
        /\bgh\s+api (?!(?:graphql(?=\s|$)|(?:-X GET\s+)?\/?search\/code(?=[?\s])))/,
      name: "gh api (not graphql/search-code)",
    },
    // Defense-in-depth: DELETE is never valid on the allowlisted endpoints
    // (graphql is POST-only, search/code is GET-only), so treat any DELETE
    // method override on gh api as hostile. Catches every flag spelling
    // (`-X DELETE`, `-XDELETE`, `-X=DELETE`, `--method[=| ]DELETE`), any case.
    // Arbitrary endpoints are already caught above; this closes the residual
    // no-op on allowlisted ones.
    {
      pattern: /\bgh\s+api\b.*(?:-X|--method)[=\s]*DELETE\b/i,
      name: "gh api -X DELETE",
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
      name: "fork bomb (recursive)",
    },
    {
      pattern: /while\s+(true|:|1)\b.*\bdo\b.*;?\s*\b(bash|sh|zsh)\b.*&.*\bdone\b/,
      name: "fork bomb (loop)",
    },
    { pattern: /\b(curl|wget)\b.+\|\s*(ba)?sh\b/, name: "pipe to shell" },
    { pattern: /\beval\b.+\$\(.*(curl|wget)\b/, name: "eval remote code" },
    {
      pattern: /\bdocker\s+volume\s+(rm|prune)\b/,
      name: "docker volume rm/prune",
    },
    { pattern: /\bcrontab\s+-r\b/, name: "crontab -r" },
    { pattern: /\bchmod\b.*\b777\b/, name: "chmod 777" },

    // Leash CLI — agent must not modify its own guardrails
    {
      pattern: /\bleash\s+(setup|remove|revoke|list|update|path)\b/,
      name: "leash CLI",
    },
    {
      pattern: /\bleash\s+allow\s+.*[\/.]/,
      name: "leash allow with path",
    },
  ];
