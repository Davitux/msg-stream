import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventRow } from "@/components/EventRow";
import { Feed } from "@/components/Feed";
import { StatusBar } from "@/components/StatusBar";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { makeTranslator } from "@/lib/i18n";
import { selectActiveProfile, useStore } from "@/lib/store";
import { allStatuses, makeEvent, resetStore } from "./helpers";
import { PLATFORM_MARKS, type ConnectionStatus, type Platform } from "@/lib/types";

const t = makeTranslator("en");
const es = makeTranslator("es");

beforeEach(resetStore);

describe("EventRow", () => {
  const noop = () => {};

  it("shows who said what, on which platform", () => {
    render(
      <EventRow
        event={makeEvent({ platform: "kick", author: { name: "braulio" }, message: "gg wp" })}
        read={false}
        locale="en"
        platformDisplay="name"
        bandBackground={false}
        t={t}
        onToggleRead={noop}
      />,
    );
    expect(screen.getByText("braulio")).toBeInTheDocument();
    expect(screen.getByText("gg wp")).toBeInTheDocument();
    expect(screen.getByText("Kick")).toBeInTheDocument();
  });

  it("shows an amount in its own unit", () => {
    render(
      <EventRow
        event={makeEvent({ amount: { value: 1000, currency: "BITS" } })}
        read={false}
        locale="en"
        platformDisplay="name"
        bandBackground={false}
        t={t}
        onToggleRead={noop}
      />,
    );
    expect(screen.getByText(/1,000 bits/)).toBeInTheDocument();
  });

  it("does not tint the row by default, only the amount", () => {
    const { container } = render(
      <EventRow
        event={makeEvent({
          platform: "youtube",
          amount: { value: 50, currency: "USD", display: "$50.00", tier: 6 },
        })}
        read={false}
        locale="en"
        platformDisplay="name"
        bandBackground={false}
        t={t}
        onToggleRead={noop}
      />,
    );
    const row = container.querySelector(".row")!;
    // The colour is still there — it is just on the amount, not the whole row.
    expect(row).toHaveAttribute("data-banded", "true");
    expect(row).not.toHaveAttribute("data-band-bg");
  });

  it("tints a row with the platform's own colour for that band", () => {
    const { container } = render(
      <EventRow
        event={makeEvent({
          platform: "youtube",
          amount: { value: 50, currency: "USD", display: "$50.00", tier: 6 },
        })}
        read={false}
        locale="en"
        platformDisplay="name"
        bandBackground={false}
        t={t}
        onToggleRead={noop}
      />,
    );
    const row = container.querySelector(".row")!;
    expect(row).toHaveAttribute("data-banded", "true");
    // YouTube's magenta band, not a colour of ours.
    // One step darker than YouTube's own magenta, for contrast — see lib/tiers.ts.
    expect(row.getAttribute("style")).toContain("#d81b60");
  });

  it("leaves a row plain when the platform publishes no ladder", () => {
    const { container } = render(
      <EventRow
        event={makeEvent({
          platform: "streamlabs",
          amount: { value: 2000, currency: "ARS" },
        })}
        read={false}
        locale="en"
        platformDisplay="name"
        bandBackground={false}
        t={t}
        onToggleRead={noop}
      />,
    );
    const row = container.querySelector(".row")!;
    expect(row).toHaveAttribute("data-tip", "true");
    expect(row).not.toHaveAttribute("data-banded");
  });

  it("marks a paid row so it can outrank the rest", () => {
    const { container } = render(
      <EventRow
        event={makeEvent({ amount: { value: 5, currency: "USD", display: "$5.00" } })}
        read={false}
        locale="en"
        platformDisplay="name"
        bandBackground={false}
        t={t}
        onToggleRead={noop}
      />,
    );
    expect(container.querySelector(".row")).toHaveAttribute("data-tip", "true");
    expect(screen.getByText("$5.00")).toBeInTheDocument();
  });

  it("reports its read state and toggles the other way when clicked", async () => {
    const user = userEvent.setup();
    const onToggleRead = vi.fn();
    render(
      <EventRow
        event={makeEvent({ id: "row-1" })}
        read={false}
        locale="en"
        platformDisplay="name"
        bandBackground={false}
        t={t}
        onToggleRead={onToggleRead}
      />,
    );

    const button = screen.getByRole("button", { name: "Mark read" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(onToggleRead).toHaveBeenCalledWith("row-1", true);
  });

  it("offers to unmark a row that is already read", () => {
    render(
      <EventRow
        event={makeEvent({ id: "row-2" })}
        read
        locale="en"
        platformDisplay="name"
        bandBackground={false}
        t={t}
        onToggleRead={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "Mark unread" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("translates its controls", () => {
    render(
      <EventRow
        event={makeEvent()}
        read={false}
        locale="es"
        platformDisplay="name"
        bandBackground={false}
        t={es}
        onToggleRead={noop}
      />,
    );
    expect(screen.getByRole("button", { name: "Marcar leído" })).toBeInTheDocument();
  });

  it("labels a sub only when no amount already says so", () => {
    const { rerender } = render(
      <EventRow
        event={makeEvent({ kind: "subscription" })}
        read={false}
        locale="en"
        platformDisplay="name"
        bandBackground={false}
        t={t}
        onToggleRead={noop}
      />,
    );
    expect(screen.getByText("sub")).toBeInTheDocument();

    rerender(
      <EventRow
        event={makeEvent({ kind: "subscription", amount: { value: 1, currency: "SUBS" } })}
        read={false}
        locale="en"
        platformDisplay="name"
        bandBackground={false}
        t={t}
        onToggleRead={noop}
      />,
    );
    expect(screen.getByText("1 sub")).toBeInTheDocument();
    expect(screen.queryByText(/^sub$/)).not.toBeInTheDocument();
  });
});

describe("EventRow — naming the source", () => {
  const noop = () => {};
  const row = (display: "name" | "mark", platform: Platform = "streamelements") =>
    render(
      <EventRow
        event={makeEvent({ platform })}
        read={false}
        locale="en"
        platformDisplay={display}
        bandBackground={false}
        t={t}
        onToggleRead={noop}
      />,
    );

  it("spells the platform out by default", () => {
    row("name");
    expect(screen.getByText("StreamElements")).toBeInTheDocument();
  });

  it("uses a compact mark when asked", () => {
    row("mark");
    expect(screen.getByText("SE")).toBeInTheDocument();
    expect(screen.queryByText("StreamElements")).not.toBeInTheDocument();
  });

  it("keeps the full name available to a screen reader", () => {
    // Switching to marks must not cost anyone the source of a message.
    const { container } = row("mark");
    expect(container.querySelector(".row-mark")).toHaveAttribute("aria-label", "StreamElements");
    expect(container.querySelector(".row-mark")).toHaveAttribute("title", "StreamElements");
  });

  it.each([
    ["youtube", "YT"],
    ["twitch", "TW"],
    ["kick", "KI"],
    ["streamlabs", "SL"],
    ["streamelements", "SE"],
    ["ceneka", "CE"],
  ] as Array<[Platform, string]>)("marks %s as %s", (platform, mark) => {
    row("mark", platform);
    expect(screen.getByText(mark)).toBeInTheDocument();
  });

  it("gives every source a distinct mark", () => {
    const marks = Object.values(PLATFORM_MARKS);
    expect(new Set(marks).size).toBe(marks.length);
  });
});

describe("EventRow — links in messages", () => {
  const noop = () => {};
  const renderMessage = (message: string) =>
    render(
      <EventRow
        event={makeEvent({ message })}
        read={false}
        locale="en"
        platformDisplay="name"
        bandBackground={false}
        t={t}
        onToggleRead={noop}
      />,
    );

  it("makes a URL clickable without changing what it says", () => {
    renderMessage("check https://example.com/clip out");
    const link = screen.getByRole("link", { name: "https://example.com/clip" });
    expect(link).toHaveAttribute("href", "https://example.com/clip");
  });

  it("opens in a new tab without handing over window.opener", () => {
    renderMessage("https://example.com");
    const rel = screen.getByRole("link").getAttribute("rel") ?? "";
    expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });

  it("keeps the surrounding words readable", () => {
    const { container } = renderMessage("mirá esto twitch.tv/alguien está bueno");
    expect(container.querySelector(".row-message")?.textContent).toBe(
      "mirá esto twitch.tv/alguien está bueno",
    );
  });

  it("links each URL in a message separately", () => {
    renderMessage("https://a.com y https://b.org");
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("leaves a message with no URL free of links", () => {
    renderMessage("buenísimo el stream hoy");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("refuses to link a javascript: URL from a stranger", () => {
    renderMessage("javascript:alert(document.cookie)");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/javascript:alert/)).toBeInTheDocument();
  });

  it("renders markup in a message as text, never as HTML", () => {
    const { container } = renderMessage('<img src=x onerror="alert(1)"> <b>bold</b>');
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector(".row-message")?.textContent).toContain("<b>bold</b>");
  });

  it("stays clickable on a paid message", () => {
    render(
      <EventRow
        event={makeEvent({
          message: "gracias! https://example.com/gift",
          amount: { value: 5, currency: "USD", display: "$5.00" },
        })}
        read={false}
        locale="en"
        platformDisplay="name"
        bandBackground={false}
        t={t}
        onToggleRead={noop}
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.com/gift");
  });

  it("does not toggle read state when a link is clicked", async () => {
    const user = userEvent.setup();
    const onToggleRead = vi.fn();
    render(
      <EventRow
        event={makeEvent({ message: "https://example.com" })}
        read={false}
        locale="en"
        platformDisplay="name"
        bandBackground={false}
        t={t}
        onToggleRead={onToggleRead}
      />,
    );
    await user.click(screen.getByRole("link"));
    expect(onToggleRead).not.toHaveBeenCalled();
  });
});

describe("Feed", () => {
  const props = {
    readIds: {},
    locale: "en" as const,
    platformDisplay: "name" as const,
    bandBackground: false,
    t,
    onToggleRead: () => {},
    hasMore: false,
    loadingHistory: false,
    onLoadOlder: () => {},
  };

  it("tells you to turn a source on when none are", () => {
    render(<Feed {...props} events={[]} anySourceOn={false} filtered={false} />);
    expect(screen.getByText("No sources on")).toBeInTheDocument();
  });

  it("blames the filter when one is hiding everything", () => {
    render(<Feed {...props} events={[]} anySourceOn filtered />);
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
  });

  it("says it is listening when connected but quiet", () => {
    render(<Feed {...props} events={[]} anySourceOn filtered={false} />);
    expect(screen.getByText("Waiting for messages")).toBeInTheDocument();
  });

  it("translates the empty state", () => {
    render(<Feed {...props} t={es} events={[]} anySourceOn={false} filtered={false} />);
    expect(screen.getByText("Sin fuentes activas")).toBeInTheDocument();
  });

  it("renders one row per event", () => {
    const events = [makeEvent({ id: "f1" }), makeEvent({ id: "f2" })];
    const { container } = render(
      <Feed {...props} events={events} anySourceOn filtered={false} />,
    );
    expect(container.querySelectorAll(".row")).toHaveLength(2);
  });

  it("offers to load older messages when there are more", async () => {
    const user = userEvent.setup();
    const onLoadOlder = vi.fn();
    render(
      <Feed
        {...props}
        events={[makeEvent({ id: "f5" })]}
        anySourceOn
        filtered={false}
        hasMore
        onLoadOlder={onLoadOlder}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Load older" }));
    expect(onLoadOlder).toHaveBeenCalled();
  });

  it("says so once the whole history is shown", () => {
    render(
      <Feed {...props} events={[makeEvent({ id: "f6" })]} anySourceOn filtered={false} />,
    );
    expect(screen.getByText("That's the whole history.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();
  });

  it("disables the button while a page is loading", () => {
    render(
      <Feed
        {...props}
        events={[makeEvent({ id: "f7" })]}
        anySourceOn
        filtered={false}
        hasMore
        loadingHistory
      />,
    );
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
  });

  it("dims the rows already read", () => {
    const events = [makeEvent({ id: "f3" }), makeEvent({ id: "f4" })];
    const { container } = render(
      <Feed {...props} readIds={{ f3: true }} events={events} anySourceOn filtered={false} />,
    );
    const rows = container.querySelectorAll(".row");
    expect(rows[0]).toHaveAttribute("data-read", "true");
    expect(rows[1]).toHaveAttribute("data-read", "false");
  });
});

describe("StatusBar", () => {
  const enabled = {
    youtube: true,
    twitch: true,
    kick: false,
    streamlabs: false,
    streamelements: false,
    ceneka: false,
  } as Record<Platform, boolean>;

  it("shows a channel per platform", () => {
    render(
      <StatusBar statuses={allStatuses()} enabled={enabled} t={t} onToggle={() => {}} />,
    );
    for (const label of ["YouTube", "Twitch", "Kick", "Streamlabs", "StreamElements", "Ceneka"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("reports a live channel as live and an off one as off", () => {
    const statuses = { ...allStatuses(), youtube: { state: "live" } } as Record<
      Platform,
      ConnectionStatus
    >;
    const { container } = render(
      <StatusBar statuses={statuses} enabled={enabled} t={t} onToggle={() => {}} />,
    );

    expect(container.querySelector('[data-platform="youtube"]')).toHaveAttribute(
      "data-state",
      "live",
    );
    // Disabled channels read as disconnected regardless of the last status.
    expect(container.querySelector('[data-platform="kick"]')).toHaveAttribute(
      "data-state",
      "disconnected",
    );
  });

  it("shows an adapter's reason in the tooltip, translated", () => {
    const statuses = {
      ...allStatuses(),
      twitch: { state: "live", detailKey: "twitchReadingFull", detailVars: { channel: "nadia" } },
    } as Record<Platform, ConnectionStatus>;

    const { container, rerender } = render(
      <StatusBar statuses={statuses} enabled={enabled} t={t} onToggle={() => {}} />,
    );
    expect(container.querySelector('[data-platform="twitch"]')).toHaveAttribute(
      "title",
      "Reading nadia with cheers and subs",
    );

    rerender(<StatusBar statuses={statuses} enabled={enabled} t={es} onToggle={() => {}} />);
    expect(container.querySelector('[data-platform="twitch"]')).toHaveAttribute(
      "title",
      "Leyendo nadia con bits y suscripciones",
    );
  });

  it("passes an untranslatable API message straight through", () => {
    const statuses = {
      ...allStatuses(),
      youtube: { state: "error", detail: "API key not valid" },
    } as Record<Platform, ConnectionStatus>;
    const { container } = render(
      <StatusBar statuses={statuses} enabled={enabled} t={t} onToggle={() => {}} />,
    );
    expect(container.querySelector('[data-platform="youtube"]')).toHaveAttribute(
      "title",
      "API key not valid",
    );
  });

  it("toggles the channel that was clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { container } = render(
      <StatusBar statuses={allStatuses()} enabled={enabled} t={t} onToggle={onToggle} />,
    );
    await user.click(container.querySelector('[data-platform="kick"]')!);
    expect(onToggle).toHaveBeenCalledWith("kick");
  });
});

describe("SettingsDrawer — appearance", () => {
  const open = () =>
    render(<SettingsDrawer open onClose={() => {}} statuses={allStatuses()} />);

  it("renders nothing when closed", () => {
    const { container } = render(
      <SettingsDrawer open={false} onClose={() => {}} statuses={allStatuses()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("switches the interface language", async () => {
    const user = userEvent.setup();
    open();

    expect(screen.getByText("Settings")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Español" }));

    expect(useStore.getState().app.locale).toBe("es");
    expect(screen.getByText("Ajustes")).toBeInTheDocument();
    expect(screen.getByText("Apariencia")).toBeInTheDocument();
  });

  it("marks the selected language and theme", async () => {
    const user = userEvent.setup();
    open();

    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Light" }));

    expect(useStore.getState().app.theme).toBe("light");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("leaves row backgrounds off by default, and can turn them on", async () => {
    const user = userEvent.setup();
    open();

    const group = screen.getByRole("group", { name: "Row background" });
    expect(within(group).getByRole("button", { name: "Off" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(within(group).getByRole("button", { name: "On" }));
    expect(useStore.getState().app.bandBackground).toBe(true);
  });

  it("switches how a source is named, and says why marks are not logos", async () => {
    const user = userEvent.setup();
    open();

    const group = screen.getByRole("group", { name: "Source label" });
    expect(within(group).getByRole("button", { name: "Name" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(within(group).getByRole("button", { name: "Mark" }));
    expect(useStore.getState().app.platformDisplay).toBe("mark");
    expect(screen.getByText(/not the platforms/)).toBeInTheDocument();
  });

  it("offers all three theme choices", () => {
    open();
    const group = screen.getByRole("group", { name: "Theme" });
    for (const name of ["System", "Dark", "Light"]) {
      expect(within(group).getByRole("button", { name })).toBeInTheDocument();
    }
  });
});

describe("SettingsDrawer — profiles", () => {
  const open = () =>
    render(<SettingsDrawer open onClose={() => {}} statuses={allStatuses()} />);

  it("adds a profile and makes it active", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: /Add profile/ }));

    const state = useStore.getState();
    expect(state.profiles).toHaveLength(2);
    expect(selectActiveProfile(state).name).toBe("New channel");
  });

  it("switches between profiles", async () => {
    const user = userEvent.setup();
    useStore.getState().addProfile("Second");
    const firstId = useStore.getState().profiles[0].id;
    open();

    await user.click(screen.getByRole("button", { name: "Switch to Main" }));
    expect(useStore.getState().activeProfileId).toBe(firstId);
  });

  it("renames the active profile", async () => {
    const user = userEvent.setup();
    open();

    const input = screen.getByLabelText("Profile name");
    await user.clear(input);
    await user.type(input, "Second channel");

    expect(selectActiveProfile(useStore.getState()).name).toBe("Second channel");
  });

  it("keeps each profile's channels apart", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText("Channel to read"), "firstchannel");
    await user.click(screen.getByRole("button", { name: /Add profile/ }));
    await user.type(screen.getByLabelText("Channel to read"), "secondchannel");

    const [first, second] = useStore.getState().profiles;
    expect(first.twitch.channel).toBe("firstchannel");
    expect(second.twitch.channel).toBe("secondchannel");
  });

  it("shares the Twitch client id across profiles, since it identifies the app", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText("Client ID"), "abc123");
    await user.click(screen.getByRole("button", { name: /Add profile/ }));

    expect(useStore.getState().app.twitchClientId).toBe("abc123");
    expect(screen.getByLabelText("Client ID")).toHaveValue("abc123");
  });

  it("asks for confirmation before deleting", async () => {
    const user = userEvent.setup();
    useStore.getState().addProfile("Second");
    open();

    await user.click(screen.getByRole("button", { name: "Delete profile" }));
    expect(useStore.getState().profiles).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /Delete the profile/ }));
    expect(useStore.getState().profiles).toHaveLength(1);
  });

  it("explains why the last profile cannot be deleted", () => {
    open();
    expect(screen.getByText("Keep at least one profile.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete profile" })).not.toBeInTheDocument();
  });
});

describe("SettingsDrawer — platforms", () => {
  const open = () =>
    render(<SettingsDrawer open onClose={() => {}} statuses={allStatuses()} />);

  it("turns a source on for the active profile", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: /YouTube.*turn on/i }));
    expect(selectActiveProfile(useStore.getState()).enabled.youtube).toBe(true);
  });

  it("only shows an error once that source is on", () => {
    const statuses = {
      ...allStatuses(),
      youtube: { state: "error", detailKey: "ytQuota" },
    } as Record<Platform, ConnectionStatus>;

    const { rerender } = render(
      <SettingsDrawer open onClose={() => {}} statuses={statuses} />,
    );
    expect(screen.queryByText(/quota used up/)).not.toBeInTheDocument();

    useStore.getState().updateProfile({
      enabled: { ...selectActiveProfile(useStore.getState()).enabled, youtube: true },
    });
    rerender(<SettingsDrawer open onClose={() => {}} statuses={statuses} />);
    expect(screen.getByText(/quota used up/)).toBeInTheDocument();
  });

  it("shows paid-only capture as selected, and says what it means", () => {
    useStore.getState().setCapture("paid");
    open();
    const group = screen.getByRole("group", { name: "Take in" });
    expect(within(group).getByRole("button", { name: "Paid only" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/Ordinary chat is ignored entirely/)).toBeInTheDocument();
  });

  it("hides the retention control while chat is being ignored", async () => {
    const user = userEvent.setup();
    useStore.getState().setCapture("paid");
    open();

    // Nothing to retain, so the control would be a lie.
    expect(screen.queryByRole("group", { name: "Keep chat for" })).not.toBeInTheDocument();

    await user.click(
      within(screen.getByRole("group", { name: "Take in" })).getByRole("button", {
        name: "Everything",
      }),
    );
    expect(useStore.getState().app.capture).toBe("all");
    expect(screen.getByRole("group", { name: "Keep chat for" })).toBeInTheDocument();
  });

  it("lets you choose how long chat is kept, and says paid is always kept", async () => {
    const user = userEvent.setup();
    open();
    await user.click(
      within(screen.getByRole("group", { name: "Take in" })).getByRole("button", {
        name: "Everything",
      }),
    );

    const group = screen.getByRole("group", { name: "Keep chat for" });
    await user.click(within(group).getByRole("button", { name: "7 days" }));
    expect(useStore.getState().app.historyDays).toBe(7);

    await user.click(within(group).getByRole("button", { name: "Forever" }));
    expect(useStore.getState().app.historyDays).toBe(0);

    expect(
      screen.getByText(/Paid messages are always kept/),
    ).toBeInTheDocument();
  });

  it("asks for confirmation before deleting stored messages", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Delete stored messages" }));
    expect(screen.getByRole("button", { name: /Delete every stored message/ })).toBeInTheDocument();
  });

  it("explains the one-time Kick chatroom id, and links to where to find it", async () => {
    const user = userEvent.setup();
    open();

    expect(screen.getByText(/paste it once/)).toBeInTheDocument();
    // Without a slug there is nothing to link to yet.
    expect(screen.getByText(/Enter the channel slug above/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Channel slug"), "somestreamer");
    const link = screen.getByRole("link", { name: /kick\.com\/api\/v2\/channels\/somestreamer/ });
    expect(link).toHaveAttribute("href", "https://kick.com/api/v2/channels/somestreamer");
  });

  it("stores the chatroom id against the active profile", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText("Chatroom ID"), "123456");
    expect(selectActiveProfile(useStore.getState()).kick.chatroomId).toBe("123456");
  });

  it("points Ceneka at the sources that actually carry it", () => {
    open();
    expect(
      screen.getByText(/delivers donations through Streamlabs or StreamElements/),
    ).toBeInTheDocument();
  });

  it("stores a Streamlabs token against the active profile", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText("Socket API token"), "sl-token");
    expect(selectActiveProfile(useStore.getState()).streamlabs.socketToken).toBe("sl-token");
  });

  it("stores a StreamElements token and its type", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText("Token"), "se-token");
    await user.click(
      within(screen.getByRole("group", { name: "Token type" })).getByRole("button", {
        name: "Overlay",
      }),
    );

    const se = selectActiveProfile(useStore.getState()).streamelements;
    expect(se.token).toBe("se-token");
    expect(se.method).toBe("apikey");
  });

  it("closes when Done is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsDrawer open onClose={onClose} statuses={allStatuses()} />);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });
});
