import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Page from "@/app/page";
import { useStore } from "@/lib/store";
import { flushFrames, makeEvent, resetStore } from "./helpers";

const chat = (id: string) => makeEvent({ id, message: "ordinary chat" });
const tip = (id: string) =>
  makeEvent({ id, kind: "tip", amount: { value: 5, currency: "USD", display: "$5.00" } });

beforeEach(resetStore);

/**
 * Mounting the page loads history, which replaces the feed — so events have to
 * go in after the render has settled, not before.
 */
async function feed(...events: ReturnType<typeof makeEvent>[]) {
  await act(async () => {
    await flushFrames();
  });
  useStore.getState().setCapture("all");
  await act(async () => {
    for (const e of events) useStore.getState().ingest(e);
    await flushFrames();
  });
}

describe("band colours reach the feed", () => {
  const superChat = (id: string, tier: number) =>
    makeEvent({
      id,
      platform: "youtube",
      kind: "tip",
      amount: { value: 50, currency: "USD", display: "$50.00", tier },
    });

  it("tints a live Super Chat with YouTube's colour for that band", async () => {
    const { container } = render(<Page />);
    await feed(superChat("sc1", 6));

    const row = container.querySelector('.row[data-tip="true"]')!;
    expect(row).toHaveAttribute("data-banded", "true");
    // One step darker than YouTube's own magenta, for contrast — see lib/tiers.ts.
    expect(row.getAttribute("style")).toContain("#d81b60");
  });

  it("still tints it after it has been through the database", async () => {
    // The whole point of persisting the tier: a reload must not strip the colour.
    render(<Page />);
    await feed(superChat("sc2", 7));

    await act(async () => {
      useStore.setState({ events: [], readIds: {} });
      await useStore.getState().loadHistory();
    });

    const row = document.querySelector('.row[data-tip="true"]')!;
    expect(row).toHaveAttribute("data-banded", "true");
    expect(row.getAttribute("style")).toContain("#e62117");
  });

  it("leaves a source with no ladder plain", async () => {
    const { container } = render(<Page />);
    await feed(
      makeEvent({
        id: "sl1",
        platform: "streamlabs",
        kind: "tip",
        amount: { value: 2000, currency: "ARS" },
      }),
    );

    const row = container.querySelector('.row[data-tip="true"]')!;
    expect(row).not.toHaveAttribute("data-banded");
  });
});

describe("the feed under paid-only capture", () => {
  it("hides the paid-only filter, since it would have nothing to do", () => {
    useStore.getState().setCapture("paid");
    render(<Page />);

    expect(screen.queryByRole("button", { name: "Paid only" })).not.toBeInTheDocument();
    // The filters that still mean something stay.
    expect(screen.getByRole("button", { name: "Unread only" })).toBeInTheDocument();
  });

  it("offers the filter again when everything is being taken in", () => {
    useStore.getState().setCapture("all");
    render(<Page />);
    expect(screen.getByRole("button", { name: "Paid only" })).toBeInTheDocument();
  });

  it("names the mode instead of repeating the count", () => {
    useStore.getState().setCapture("paid");
    render(<Page />);
    expect(screen.getByText("Paid only")).toBeInTheDocument();
  });

  it("hides chat left in history from before the setting changed", async () => {
    // Switching to paid-only must not leave old chat reappearing on reload,
    // which would contradict the setting.
    render(<Page />);
    await feed(chat("c1"), tip("t1"));
    expect(screen.getByText("ordinary chat")).toBeInTheDocument();

    await act(async () => useStore.getState().setCapture("paid"));

    expect(screen.getByText("$5.00")).toBeInTheDocument();
    expect(screen.queryByText("ordinary chat")).not.toBeInTheDocument();
  });

  it("shows that chat again when everything is taken in", async () => {
    render(<Page />);
    await feed(chat("c1"), tip("t1"));

    expect(screen.getByText("ordinary chat")).toBeInTheDocument();
    expect(screen.getByText("$5.00")).toBeInTheDocument();
  });

  it("leaves the unread filter working under paid-only capture", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await feed(tip("t1"), tip("t2"));
    await act(async () => useStore.getState().setCapture("paid"));
    expect(screen.getAllByText("$5.00")).toHaveLength(2);

    await act(async () => useStore.getState().markRead("t1", true));
    await user.click(screen.getByRole("button", { name: "Unread only" }));

    expect(screen.getAllByText("$5.00")).toHaveLength(1);
  });
});
