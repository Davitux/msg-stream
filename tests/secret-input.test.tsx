import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { REVEAL_MS, SecretInput } from "@/components/SecretInput";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { makeTranslator } from "@/lib/i18n";
import { selectActiveProfile, useStore } from "@/lib/store";
import { allStatuses, resetStore } from "./helpers";

const t = makeTranslator("en");
const es = makeTranslator("es");

const field = () => screen.getByLabelText("Token") as HTMLInputElement;

/** The component is controlled, so a test needs a parent that actually holds state. */
function Controlled({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <SecretInput
      label="Token"
      value={value}
      t={t}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

beforeEach(resetStore);
afterEach(() => vi.useRealTimers());

describe("SecretInput", () => {
  const setup = (value = "super-secret") =>
    render(<SecretInput label="Token" value={value} t={t} onChange={() => {}} />);

  it("is masked until asked otherwise", () => {
    setup();
    expect(field()).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Show" })).toBeInTheDocument();
  });

  it("reveals only on a deliberate click", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(field()).toHaveAttribute("type", "text");
    expect(field()).toHaveValue("super-secret");
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
  });

  it("can be hidden again immediately", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Show" }));
    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(field()).toHaveAttribute("type", "password");
  });

  // fireEvent rather than userEvent here: userEvent schedules its own async
  // work, which deadlocks against fake timers.
  const reveal = () => fireEvent.click(screen.getByRole("button", { name: "Show" }));
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it("hides itself again so it cannot be left on screen", () => {
    // The point of the whole feature: walking away must not leave a token
    // readable on a stream.
    vi.useFakeTimers();
    setup();

    reveal();
    expect(field()).toHaveAttribute("type", "text");

    wait(REVEAL_MS - 100);
    expect(field()).toHaveAttribute("type", "text");

    wait(200);
    expect(field()).toHaveAttribute("type", "password");
  });

  it("restarts the countdown when revealed again", () => {
    vi.useFakeTimers();
    setup();

    reveal();
    wait(REVEAL_MS + 100);
    expect(field()).toHaveAttribute("type", "password");

    reveal();
    wait(REVEAL_MS - 100);
    expect(field()).toHaveAttribute("type", "text");
  });

  it("stays editable while masked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.type(field(), "abc");
    expect(onChange).toHaveBeenLastCalledWith("abc");
    expect(field()).toHaveValue("abc");
    expect(field()).toHaveAttribute("type", "password");
  });

  it("trims a pasted token, since stray whitespace is never part of one", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.click(field());
    await user.paste("  tok-123  ");
    expect(onChange).toHaveBeenLastCalledWith("tok-123");
  });

  it("translates its control", () => {
    render(<SecretInput label="Token" value="x" t={es} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Mostrar" })).toBeInTheDocument();
  });
});

describe("credentials in Settings", () => {
  const open = () =>
    render(<SettingsDrawer open onClose={() => {}} statuses={allStatuses()} />);

  it("masks every credential and nothing else", () => {
    open();
    for (const label of ["API key", "Socket API token", "Token"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("type", "password");
    }
    // The Twitch client ID is public by design — masking it would only stop you
    // checking you pasted the right one.
    expect(screen.getByLabelText("Client ID")).not.toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Channel slug")).not.toHaveAttribute("type", "password");
  });

  it("offers a reveal control on each credential", () => {
    open();
    expect(screen.getAllByRole("button", { name: "Show" })).toHaveLength(3);
  });

  it("reveals one credential without exposing the others", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getAllByRole("button", { name: "Show" })[0]);
    expect(screen.getByLabelText("API key")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Socket API token")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Token")).toHaveAttribute("type", "password");
  });

  it("starts masked again after the drawer is closed and reopened", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <SettingsDrawer open onClose={() => {}} statuses={allStatuses()} />,
    );

    await user.click(screen.getAllByRole("button", { name: "Show" })[0]);
    expect(screen.getByLabelText("API key")).toHaveAttribute("type", "text");

    rerender(<SettingsDrawer open={false} onClose={() => {}} statuses={allStatuses()} />);
    rerender(<SettingsDrawer open onClose={() => {}} statuses={allStatuses()} />);

    expect(screen.getByLabelText("API key")).toHaveAttribute("type", "password");
  });

  it("still saves what is typed into a credential", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText("Socket API token"), "sl-abc");
    expect(selectActiveProfile(useStore.getState()).streamlabs.socketToken).toBe("sl-abc");
  });
});
