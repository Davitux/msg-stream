import { describe, expect, it } from "vitest";
import { hasLink, parseMessageSegments, toSafeHref } from "@/lib/linkify";

/** Just the link segments, as [visibleText, href] pairs. */
const links = (text: string) =>
  parseMessageSegments(text)
    .filter((s) => s.type === "link")
    .map((s) => [s.value, s.type === "link" ? s.href : ""]);

/** Reassembling the segments must always give the original text back. */
const roundTrip = (text: string) =>
  parseMessageSegments(text)
    .map((s) => s.value)
    .join("");

describe("finding links", () => {
  it("links an explicit https URL", () => {
    expect(links("check https://example.com/watch?v=1")).toEqual([
      ["https://example.com/watch?v=1", "https://example.com/watch?v=1"],
    ]);
  });

  it("links plain http too", () => {
    expect(links("http://example.com")[0][1]).toBe("http://example.com/");
  });

  it("links a www. host with no scheme, defaulting to https", () => {
    expect(links("go to www.example.com now")).toEqual([
      ["www.example.com", "https://www.example.com/"],
    ]);
  });

  it("links a bare domain with a known TLD", () => {
    expect(links("twitch.tv/somestreamer")).toEqual([
      ["twitch.tv/somestreamer", "https://twitch.tv/somestreamer"],
    ]);
  });

  it("finds several links in one message", () => {
    expect(links("https://a.com and https://b.org/x")).toHaveLength(2);
  });

  it("keeps query strings, fragments and ports intact", () => {
    const [[value, href]] = links("https://example.com:8443/a/b?x=1&y=2#frag");
    expect(value).toBe("https://example.com:8443/a/b?x=1&y=2#frag");
    expect(href).toContain("?x=1&y=2");
    expect(href).toContain("#frag");
  });

  it("reports whether a message has a link at all", () => {
    expect(hasLink("visit example.com")).toBe(true);
    expect(hasLink("no links here")).toBe(false);
    expect(hasLink("")).toBe(false);
  });
});

describe("leaving ordinary text alone", () => {
  it.each([
    ["plain prose", "buenísimo el stream hoy"],
    ["a file name", "look at index.php"],
    ["a library name", "written in node.js"],
    ["a decimal", "that costs 10.50"],
    ["an abbreviation", "e.g. this one"],
    ["an ellipsis", "wait for it..."],
    ["an unknown TLD", "some.zzzz thing"],
  ])("does not link %s", (_label, text) => {
    expect(links(text)).toEqual([]);
  });

  it("returns a single text segment when there is nothing to link", () => {
    const segments = parseMessageSegments("just talking");
    expect(segments).toEqual([{ type: "text", value: "just talking" }]);
  });

  it("returns nothing for an empty message", () => {
    expect(parseMessageSegments("")).toEqual([]);
  });
});

describe("where the link ends", () => {
  it("leaves a sentence's full stop out of the link", () => {
    expect(links("see https://example.com/a.")).toEqual([
      ["https://example.com/a", "https://example.com/a"],
    ]);
  });

  it.each([",", ";", ":", "!", "?", '"', "'"])("leaves a trailing %s out", (mark) => {
    expect(links(`see https://example.com${mark}`)[0][0]).toBe("https://example.com");
  });

  it("keeps balanced brackets that belong to the URL", () => {
    expect(links("https://en.wikipedia.org/wiki/Foo_(bar)")[0][0]).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    );
  });

  it("drops a closing bracket that was wrapping the URL", () => {
    expect(links("(see https://example.com/a)")[0][0]).toBe("https://example.com/a");
  });

  it("stops at whitespace", () => {
    expect(links("https://example.com/a next word")[0][0]).toBe("https://example.com/a");
  });
});

describe("segments preserve the message exactly", () => {
  it.each([
    "check https://example.com/a. thanks",
    "twitch.tv/x and www.y.com plus text",
    "no links at all",
    "  leading and trailing  ",
    "https://example.com",
    "múltiples acentos y https://example.com/ñ",
  ])("round-trips %s", (text) => {
    expect(roundTrip(text)).toBe(text);
  });

  it("keeps the text around a link in the right order", () => {
    expect(parseMessageSegments("before https://example.com after")).toEqual([
      { type: "text", value: "before " },
      { type: "link", value: "https://example.com", href: "https://example.com/" },
      { type: "text", value: " after" },
    ]);
  });
});

describe("refusing dangerous URLs", () => {
  // These are the payloads that matter: messages come from strangers.
  it.each([
    ["javascript", "javascript:alert(1)"],
    ["javascript with mixed case", "JaVaScRiPt:alert(1)"],
    ["data", "data:text/html,<script>alert(1)</script>"],
    ["vbscript", "vbscript:msgbox(1)"],
    ["file", "file:///etc/passwd"],
    ["about", "about:blank"],
  ])("never links a %s URL", (_label, text) => {
    expect(links(text)).toEqual([]);
    expect(roundTrip(text)).toBe(text);
  });

  it("rejects non-http schemes at the href level too", () => {
    expect(toSafeHref("javascript:alert(1)")).toBeNull();
    expect(toSafeHref("data:text/html,x")).toBeNull();
    expect(toSafeHref("")).toBeNull();
  });

  it("only ever produces http or https", () => {
    for (const candidate of ["example.com", "www.example.com", "https://example.com"]) {
      const href = toSafeHref(candidate)!;
      expect(href.startsWith("http://") || href.startsWith("https://")).toBe(true);
    }
  });

  it("does not treat a javascript URL hidden after text as a link", () => {
    expect(links("click here javascript:alert(document.cookie)")).toEqual([]);
  });

  it("shows the destination as its own label, so it cannot lie about where it goes", () => {
    // No display-text/href mismatch is possible: the label IS the URL.
    for (const [value, href] of links("pay at https://evil.example.com/paypal.com")) {
      expect(href).toContain(new URL(String(value).startsWith("http") ? String(value) : `https://${value}`).hostname);
    }
  });

  it("does not choke on angle brackets or quotes in a message", () => {
    const text = `<b>hi</b> "https://example.com" 'x'`;
    expect(roundTrip(text)).toBe(text);
    expect(links(text)[0][0]).toBe("https://example.com");
  });

  it("leaves a very long message untouched rather than scanning it", () => {
    const huge = `${"a".repeat(5000)} https://example.com`;
    expect(parseMessageSegments(huge)).toEqual([{ type: "text", value: huge }]);
  });

  it("handles a pathological run of dots without hanging", () => {
    const start = Date.now();
    parseMessageSegments(`${"a.".repeat(2000)}!`);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
