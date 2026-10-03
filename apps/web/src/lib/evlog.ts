import { createEvlog } from "evlog/next";
import { createInstrumentation } from "evlog/next/instrumentation/create";

export const { withEvlog, useLogger, log, createError } = createEvlog({
  service: "jendal-workspace-web",
});

export const { register, onRequestError } = createInstrumentation({
  service: "jendal-workspace-web",
});
