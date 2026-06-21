import "server-only";
import { CronExpressionParser } from "cron-parser";

// Parsing + validation of a project repo's `cron.json` (the source of truth for
// its schedules). The dispatcher reads this; the agent owns/edits it. Schedules
// are evaluated in UTC.

export const CRON_FILE = "cron.json";

export type CronJob = {
  name: string;
  schedule: string; // standard 5-field cron expression
  prompt: string;
  model: string | null;
  enabled: boolean;
};

/** Next fire time strictly after `from`, computed in UTC. */
export function nextRunAfter(schedule: string, from: Date): Date {
  return CronExpressionParser.parse(schedule, {
    currentDate: from,
    tz: "UTC",
  })
    .next()
    .toDate();
}

/** True if `schedule` is a parseable cron expression. */
export function isValidCron(schedule: string): boolean {
  try {
    CronExpressionParser.parse(schedule, { tz: "UTC" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse + validate raw `cron.json` text into jobs. Throws on any malformed
 * entry so the dispatcher can skip the whole file rather than fire a bad job.
 */
export function parseCronFile(text: string): CronJob[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("cron.json is not valid JSON.");
  }
  if (!Array.isArray(data)) {
    throw new Error("cron.json must be a JSON array of jobs.");
  }

  const seen = new Set<string>();
  return data.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new Error(`cron.json[${i}] must be an object.`);
    }
    const o = raw as Record<string, unknown>;

    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name) throw new Error(`cron.json[${i}] is missing a non-empty "name".`);
    if (seen.has(name)) throw new Error(`cron.json has duplicate job name "${name}".`);
    seen.add(name);

    const schedule = typeof o.schedule === "string" ? o.schedule.trim() : "";
    if (!isValidCron(schedule)) {
      throw new Error(`Job "${name}" has an invalid cron schedule: ${JSON.stringify(o.schedule)}.`);
    }

    const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
    if (!prompt) throw new Error(`Job "${name}" is missing a non-empty "prompt".`);

    const model =
      o.model === undefined || o.model === null
        ? null
        : typeof o.model === "string"
          ? o.model.trim() || null
          : (() => {
              throw new Error(`Job "${name}" has a non-string "model".`);
            })();

    const enabled = o.enabled === undefined ? true : Boolean(o.enabled);

    return { name, schedule, prompt, model, enabled };
  });
}
