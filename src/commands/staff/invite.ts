import {defineCommand} from "citty";
import addCommand from "./add";

/**
 * `invite` and `add` are the same operation on the same endpoint — a staff member is created
 * and notified either way. Rather than keep two flows that drift apart (this one was flags-only
 * and unvalidated, `add` prompts and validates), it reuses `add` wholesale and differs only in
 * name, so whichever verb a merchant reaches for behaves identically.
 */
export default defineCommand({
  ...addCommand,
  meta: {name: "invite", description: "Invite a new staff member to this business (same as `staff add`)"}
});
