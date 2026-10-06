import { describe, expect, it } from "vitest";

import { createFakeMailer } from "./fake";
import type { EmailMessage } from "./mailer";

describe("createFakeMailer", () => {
  it("records every message it is asked to send", async () => {
    const mailer = createFakeMailer();
    const message: EmailMessage = {
      sender: "accounts",
      tag: "verification",
      to: "ada@example.com",
      subject: "Hi",
      text: "Hello",
      html: "<p>Hello</p>",
    };

    await mailer.send(message);

    expect(mailer.sent).toEqual([message]);
  });
});
