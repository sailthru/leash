import { join as join3 } from "path";
import { readFileSync as readFileSync2, lstatSync as lstatSync2 } from "fs";

export interface LeashrcConfig {
  allow: string[];
}

export function parseLeashrc(content: string): LeashrcConfig {
  const allow: string[] = [];
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
export function readLeashrc(cwd: string): LeashrcConfig {
  const filePath = join3(cwd, ".leashrc");
  try {
    if (lstatSync2(filePath).isSymbolicLink()) return { allow: [] };
    const content = readFileSync2(filePath, "utf-8");
    return parseLeashrc(content);
  } catch {
    return { allow: [] };
  }
}
