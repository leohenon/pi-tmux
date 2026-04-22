import * as path from "node:path";
import { type ExtensionAPI, SessionManager } from "@mariozechner/pi-coding-agent";

const TMUX_SCRIPT = path.resolve(__dirname, "../bin/pi-tmux");

function inTmux(): boolean {
  return Boolean(process.env.TMUX);
}

function deriveLockName(sessionFile: string): string {
  const base = path.basename(sessionFile, path.extname(sessionFile));
  const sanitized = base.replace(/[^A-Za-z0-9._-]/g, "-");
  const suffix = sanitized.slice(-8) || "sess";
  return `fork-${suffix}`;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("fork-split", {
    description:
      "Fork the current session from the latest user message and open it in a new tmux split pane",
    handler: async (_args, ctx) => {
      if (!inTmux()) {
        ctx.ui.notify("fork-split: not running in tmux", "error");
        return;
      }

      const currentFile = ctx.sessionManager.getSessionFile();
      if (!currentFile) {
        ctx.ui.notify("fork-split: no persisted session to fork", "error");
        return;
      }

      const branch = ctx.sessionManager.getBranch();
      const latestUserMessage = [...branch].reverse().find(
        (entry) => entry.type === "message" && entry.message.role === "user",
      );
      if (!latestUserMessage) {
        ctx.ui.notify("fork-split: no user message found to fork from", "error");
        return;
      }

      const sessionDir = ctx.sessionManager.getSessionDir();
      let newPath: string | undefined;
      try {
        if (!latestUserMessage.parentId) {
          const sm = SessionManager.create(ctx.cwd, sessionDir);
          sm.newSession({ parentSession: currentFile });
          newPath = sm.getSessionFile();
        } else {
          const src = SessionManager.open(currentFile, sessionDir);
          newPath = src.createBranchedSession(latestUserMessage.parentId);
        }
      } catch (err) {
        ctx.ui.notify(
          `fork-split: failed to create branched session: ${(err as Error).message}`,
          "error",
        );
        return;
      }
      if (!newPath) {
        ctx.ui.notify("fork-split: branched session path unavailable", "error");
        return;
      }

      const lockName = deriveLockName(newPath);
      const result = await pi.exec("bash", [
        TMUX_SCRIPT,
        "split",
        lockName,
        `pi --session ${newPath}`,
      ]);

      if (result.code !== 0) {
        const text = (result.stderr || result.stdout || "").trim() || `exit ${result.code}`;
        ctx.ui.notify(`fork-split failed: ${text}`, "error");
        return;
      }

      ctx.ui.notify(`Forked into split: ${lockName}`, "info");
    },
  });
}
