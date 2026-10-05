export const CORE_VERSION = "0.1.0";
export { EventBus, type DeckEvent } from "./events.js";
export { TaskBoard, type Task, type TaskStatus } from "./taskboard.js";
export { Scheduler, nextRun, type Job } from "./scheduler.js";
export { runStartupChecks, summarize, clockProbe, diskProbe, CHECKS, type CheckId, type CheckResult, type CheckStatus, type Probe, type Readiness } from "./startup-checks.js";
