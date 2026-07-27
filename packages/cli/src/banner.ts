/**
 * StateScry CLI Visual Banners & Animations
 * Mood: Night Surveillance / Scrying Lens / Cool Cyber Teal & Indigo
 */

// Truecolor / ANSI Helpers
const RESET = "\x1b[0m";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\r\x1b[K";

// Palette: Scrying Lens / Night Surveillance
const C = {
  lensCyan: "\x1b[38;2;6;182;212m", // #06b6d4
  brightTeal: "\x1b[38;2;45;212;191m", // #2dd4bf
  emeraldGlow: "\x1b[38;2;16;185;129m", // #10b981
  indigoSky: "\x1b[38;2;99;102;241m", // #6366f1
  mutedViolet: "\x1b[38;2;129;140;248m", // #818cf8
  darkSlate: "\x1b[38;2;30;41;59m", // #1e293b
  subtleDim: "\x1b[38;2;100;116;139m", // #64748b
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

/**
 * Direction 1: Bold Constellation & Graph Box Wordmark
 * Static, instant, and high-impact graph diagram framing.
 */
export function renderDirection1(): string {
  const line = `${C.darkSlate}─${RESET}`;
  const borderTop = `${C.darkSlate}┌${line.repeat(61)}┐${RESET}`;
  const borderBot = `${C.darkSlate}└${line.repeat(61)}┘${RESET}`;
  const v = `${C.darkSlate}│${RESET}`;

  return [
    "",
    borderTop,
    `${v}  ${C.indigoSky}◯${RESET}${C.darkSlate}───►${RESET}${C.brightTeal}◯${RESET}${C.darkSlate}───►${RESET}${C.lensCyan}◯${RESET}   ${C.bold}${C.brightTeal}S T A T E S C R Y${RESET} ${C.subtleDim}v2.0.4${RESET}             ${v}`,
    `${v}  ${C.darkSlate}│     ▲     │${RESET}   ${C.subtleDim}👁 Scrying Lens · Behavioral Graph Memory${RESET}  ${v}`,
    `${v} ${C.darkSlate}[S₀]───┴────►[S₁]${RESET}  ${C.emeraldGlow}● Local SQLite Index${RESET}  ${C.indigoSky}● 11 MCP Tools${RESET}    ${v}`,
    borderBot,
    "",
  ].join("\n");
}

/**
 * Direction 2: Graph-Construction Staged Boot Sequence
 * Nodes materialize, connect with action edges, and lock into the wordmark.
 */
export async function animateDirection2(): Promise<void> {
  if (!process.stdout.isTTY) return;

  const frames = [
    // Frame 0: Initializing node points
    [
      ` ${C.subtleDim}(S₀)${RESET}                           ${C.subtleDim}(S₁)${RESET}`,
      `   ${C.darkSlate}⬡  Initializing state graph...${RESET}`,
    ],
    // Frame 1: Action edge expanding
    [
      ` ${C.indigoSky}(S₀)${RESET}${C.lensCyan} ──[click]──► ${RESET}${C.brightTeal}(S₁)${RESET}`,
      `   ${C.lensCyan}⬢  Scrying interactive DOM transitions...${RESET}`,
    ],
    // Frame 2: Branching to second state node
    [
      ` ${C.indigoSky}(S₀)${RESET}${C.lensCyan} ──[click]──► ${RESET}${C.brightTeal}(S₁)${RESET}${C.darkSlate} ──[submit]──► ${RESET}${C.emeraldGlow}(S₂)${RESET}`,
      `   ${C.brightTeal}⬢  Fingerprinting semantic state hashes...${RESET}`,
    ],
    // Frame 3: Materializing Wordmark Lockup
    [
      ` ${C.indigoSky}◯${RESET}${C.darkSlate}──►${RESET}${C.brightTeal}◯${RESET}${C.darkSlate}──►${RESET}${C.emeraldGlow}◯${RESET}  ${C.bold}${C.brightTeal}S T A T E S C R Y${RESET} ${C.subtleDim}v2.0.4${RESET}`,
      ` ${C.subtleDim}👁 Behavioral Memory & Graph Replay Engine${RESET}`,
    ],
  ];

  process.stdout.write(HIDE_CURSOR);
  for (let idx = 0; idx < frames.length; idx++) {
    const lines = frames[idx];
    if (!lines) continue;
    if (idx > 0) {
      // Move up 2 lines and clear
      process.stdout.write("\x1b[2A\x1b[0J");
    }
    process.stdout.write(`${lines[0]}\n${lines[1]}\n`);
    await new Promise((resolve) =>
      setTimeout(resolve, idx === frames.length - 1 ? 100 : 160),
    );
  }
  process.stdout.write(SHOW_CURSOR);
}

/**
 * Direction 3: The Scrying Lens Radar Scanner (Revealing Hidden Behavior)
 * Simulates a lens scanning an app and illuminating hidden state nodes.
 */
export async function animateDirection3(): Promise<void> {
  if (!process.stdout.isTTY) return;

  const sweep = ["◤ ", " ◥", " ◢", "◣ "];
  const states = ["[Root]", "[Auth]", "[Dashboard]", "[Settings]"];

  process.stdout.write(HIDE_CURSOR);
  process.stdout.write(
    `\n${C.lensCyan}👁  S T A T E S C R Y${RESET}  ${C.subtleDim}v2.0.4${RESET}\n`,
  );

  for (let step = 0; step < 8; step++) {
    const icon = sweep[step % sweep.length];
    const revealed = states
      .slice(0, Math.floor(step / 2) + 1)
      .join(`${C.darkSlate} ──► ${C.brightTeal}`);
    process.stdout.write(
      `${CLEAR_LINE}${C.brightTeal}${icon}${RESET} ${C.subtleDim}Scrying live DOM:${RESET} ${C.indigoSky}${revealed}${RESET}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 110));
  }

  process.stdout.write(
    `\n${C.emeraldGlow}✔ Scrying Lens Active${RESET} · ${C.subtleDim}Graph index ready.${RESET}\n\n`,
  );
  process.stdout.write(SHOW_CURSOR);
}

/**
 * Standard Entry Point for CLI Banner
 */
export async function displayStateScryBanner(jsonMode = false): Promise<void> {
  if (jsonMode) return;
  if (!process.stdout.isTTY) {
    process.stdout.write(
      "🔮 StateScry v2.0.3 — Behavioral Memory for Web Apps\n",
    );
    return;
  }
  await animateDirection2();
}
