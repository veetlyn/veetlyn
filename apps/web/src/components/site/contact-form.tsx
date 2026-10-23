"use client";

import { type FormEvent, useEffect, useState } from "react";
import { z } from "zod";

import { usePlatformInfo } from "@/components/platform-name";
import { contactEmail } from "@/content/legal/meta";

const TOPICS = ["Enterprise and sales", "Network membership", "Support", "Partnership", "Press"] as const;
const TOPIC_FOR_HASH = new Map<string, (typeof TOPICS)[number]>([
  ["#sales", "Enterprise and sales"],
  ["#membership", "Network membership"],
]);

const formSchema = z.object({
  topic: z.string(),
  name: z.string(),
  company: z.string(),
  size: z.string(),
  sells: z.string(),
  message: z.string(),
});

// The form writes the email in the visitor's own mail app; nothing is sent from the page. #sales and #membership
// pick the topic.
export default function ContactForm() {
  const [topic, setTopic] = useState<string>(TOPICS[0]);
  const email = contactEmail(usePlatformInfo().domain);

  useEffect(() => {
    const pick = () => {
      const fromHash = TOPIC_FOR_HASH.get(window.location.hash);
      if (fromHash) setTopic(fromHash);
    };
    pick();
    addEventListener("hashchange", pick);
    return () => removeEventListener("hashchange", pick);
  }, []);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = formSchema.parse(Object.fromEntries(new FormData(e.currentTarget)));
    const body = [`Name: ${f.name}`, `Company: ${f.company}`, `I sell: ${f.sells}`, `Team size: ${f.size}`, "", f.message].join(
      "\n",
    );
    const subject = `${f.topic}: ${f.company || f.name}`;
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <form className="mail" id="mail" data-in onSubmit={onSubmit}>
      <label className="f">
        Topic
        <select name="topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
          {TOPICS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <div className="two">
        <label className="f">
          Your name
          <input name="name" autoComplete="name" required />
        </label>
        <label className="f">
          Work email
          <input name="email" type="email" autoComplete="email" required />
        </label>
      </div>
      <div className="two">
        <label className="f">
          Company
          <input name="company" autoComplete="organization" />
        </label>
        <label className="f">
          Team size
          <select name="size">
            <option>Just me</option>
            <option>2 to 10</option>
            <option>11 to 50</option>
            <option>More than 50</option>
          </select>
        </label>
      </div>
      <label className="f">
        What do you sell?
        <select name="sells">
          <option>Services</option>
          <option>Products</option>
          <option>Services and products</option>
        </select>
      </label>
      <label className="f">
        Message
        <textarea name="message" required />
      </label>
      <button className="btn btn-ink" type="submit">
        Write the email
      </button>
      <p className="form-note">
        This opens your email app with the message ready to send to {email}. Nothing is sent until you press
        send there.
      </p>
    </form>
  );
}
