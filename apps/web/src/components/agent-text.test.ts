// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AgentText from "./agent-text";

const render = (text: string) => renderToStaticMarkup(createElement(AgentText, { text }));

describe("AgentText", () => {
  it("draws single-asterisk emphasis instead of printing the asterisks", () => {
    const html = render("The request is *above* auto-approve.");
    expect(html).toContain("<em");
    expect(html).not.toContain("*");
  });

  it("shows inline code as plain words, without backticks", () => {
    const html = render("The project is `completed` and paid.");
    expect(html).not.toContain("`");
    expect(html).toContain("completed");
  });

  it("keeps star bullets as a list and bold as bold", () => {
    const html = render("* **Paid:** $220.00\n* Deliveries: 2");
    expect(html).toContain("<ul");
    expect(html).toContain("<strong");
    expect(html).not.toContain("*");
  });

  it("never turns record text into markup", () => {
    expect(render("<img src=x onerror=alert(1)>")).not.toContain("<img");
  });
});
