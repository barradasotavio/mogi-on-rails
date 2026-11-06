"use client";

import {
  Archive,
  ArrowLeft,
  HardDrive,
  ImagePlus,
  Laptop,
  type LucideIcon,
  Monitor,
  Pencil,
  Plus,
  Route,
  ScanText,
  Smartphone,
  SquarePlus,
  SquareTerminal,
  WifiOff,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { createPortal } from "react-dom";

import { ListRadioGroup } from "@/components/ui/choice";
import { Disclosure } from "@/components/ui/disclosure";
import { FloatingBar } from "@/components/ui/floating-bar";
import { GlassButton } from "@/components/ui/glass-button";
import { IllustrationStage, PhoneAlbumArt, ResultsScreenArt } from "@/components/ui/illustration";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ListGroup } from "@/components/ui/list";
import { MogiScrollBody } from "@/components/ui/mogi-scroll-body";
import { RaceTile } from "@/components/ui/race-tile";
import { Textarea } from "@/components/ui/textarea";
import { TileButton } from "@/components/ui/tile-button";
import { SidebarToggle, Toolbar } from "@/components/ui/toolbar";
import { withBase } from "@/lib/base-path";
import { type InstallPlatform, installPlatform } from "@/lib/install";
import { cn } from "@/vendor/shadcn/lib/utils";

const NSO_ALBUM_SYNC = "https://github.com/Dycool/NSO-Album-Sync";

/**
 * Instructions: the landing page of someone with no mogis yet, and the app's manual, in the order of a mogi.
 * A destination beside the mogis, like Tracks: the toolbar on regular, Back in the floating bar on compact.
 * One page, spaced as a long page (`page-stack`): the hero (the app's name over a benefit headline) with three
 * proof cards, "How it works" (six illustrated step cards in a bento grid, each leading with its benefit in bold), "Get more out of it", "Install the app" (the only place that says how to
 * install, this system's steps first), and the licenses. The game and the Nintendo app are drawn, never captured; this app is drawn with its own
 * components, inert. Control names follow copy.md: a change to a workflow described here updates this page in
 * the same change.
 */
export function InstructionsScreen({
  busy,
  visible,
  controlsContainer,
  mogisShown,
  newInToolbar,
  canInstall,
  onShowMogis,
  onBack,
  onNew,
  onInstall,
}: {
  busy: boolean;
  visible: boolean;
  controlsContainer: HTMLElement | null;
  mogisShown: boolean;
  /** With the sidebar closed, New Mogi joins the toolbar, as on the list. */
  newInToolbar: boolean;
  /** The browser offers its own install dialog, which Install App opens; it is the app's only install control. */
  canInstall: boolean;
  onShowMogis: () => void;
  onBack: () => void;
  onNew: () => void;
  onInstall: () => void;
}) {
  const [platform] = useState(installPlatform);
  const systems = installSystems
    .filter((system) => system.platform === platform)
    .concat(installSystems.filter((system) => system.platform !== platform));
  return (
    <section className="@container relative min-h-full">
      {visible &&
        controlsContainer &&
        createPortal(
          <>
            <Toolbar
              aria-label="Instructions actions"
              leading={<SidebarToggle placement="toolbar" expanded={mogisShown} onClick={onShowMogis} />}
              trailing={
                newInToolbar && (
                  <GlassButton tint density="toolbar" disabled={busy} onClick={onNew}>
                    <Plus aria-hidden="true" />
                    New Mogi
                  </GlassButton>
                )
              }
            />
            <FloatingBar className="mx-auto max-w-xl" aria-label="Instructions actions">
              <GlassButton shape="circle" aria-label="Back" onClick={onBack}>
                <ArrowLeft aria-hidden="true" />
              </GlassButton>
            </FloatingBar>
          </>,
          controlsContainer,
        )}
      <MogiScrollBody>
        <div className="page-stack">
          <div className="section-stack">
            <header className="flex flex-col gap-3 px-4">
              <h1 data-mogi-title tabIndex={-1} className="font-semibold text-link outline-none">
                Mogi on Rails
              </h1>
              <p className="text-4xl font-bold tracking-tight @[45rem]:text-5xl">
                Your mogis, tallied from your screenshots
              </p>
              <p className="max-w-prose text-lg text-muted-foreground">
                Paste the bot list, add a screenshot after each race and copy the table when it&apos;s over.
              </p>
            </header>
            <ul aria-label="Highlights" className="grid gap-6 px-4 @[45rem]:grid-cols-3 @[45rem]:gap-8">
              <Highlight Icon={ScanText} proof="Names, places and points, read on this device.">
                Reads your screenshots
              </Highlight>
              <Highlight Icon={WifiOff} proof="Nothing to sign up for, nothing to sync.">
                Works offline, no account
              </Highlight>
              <Highlight Icon={HardDrive} proof="Mogis and screenshots never leave it.">
                Your data stays on this device
              </Highlight>
            </ul>
          </div>
          <ListGroup inset title="How it works">
            <ol className="@container grid gap-3 @[36rem]:grid-cols-2 @[54rem]:grid-cols-3">
              {steps.map(({ text, ...step }) => (
                <Step key={step.number} {...step}>
                  {text}
                </Step>
              ))}
            </ol>
          </ListGroup>
          <ListGroup inset title="Get more out of it">
            {/* In a div: list-group pulls a bare list up to its rows' ink, and these items are not rows. */}
            <div>
              <ul aria-label="More features" className="section-stack">
                <Feature Icon={Pencil} title="Fix races and names">
                  Missed a screenshot or got a wrong place? Open the race to add a screenshot or edit the result. Say
                  who a name or sub is once in Players.
                </Feature>
                <Feature Icon={Route} title="Analyze your tracks">
                  See which tracks to vote for and which to practice, from your places across your last mogis.
                </Feature>
                <Feature Icon={Archive} title="Keep your data">
                  A backup keeps your mogis safe and moves them to another device, or between the browser and the
                  installed app.
                </Feature>
              </ul>
            </div>
          </ListGroup>
          <ListGroup inset title="Install the app">
            <div className="section-stack">
              <ul aria-label="How to install">
                {systems.slice(0, 1).map((system) => (
                  <Feature
                    key={system.platform}
                    Icon={system.Icon}
                    title={system.title}
                    action={
                      canInstall && (
                        <GlassButton tint onClick={onInstall}>
                          <SquarePlus aria-hidden="true" />
                          Install App
                        </GlassButton>
                      )
                    }
                  >
                    <Lead>Opens offline and keeps your mogis safer.</Lead> {system.steps}
                  </Feature>
                ))}
              </ul>
              <Disclosure title="Other devices">
                <ul aria-label="Other devices" className="section-stack">
                  {systems.slice(1).map((system) => (
                    <Feature key={system.platform} Icon={system.Icon} title={system.title}>
                      {system.steps}
                    </Feature>
                  ))}
                </ul>
              </Disclosure>
            </div>
          </ListGroup>
          <p className="px-4 text-sm text-muted-foreground">
            <a
              href={withBase("/licenses/third-party-notices.txt")}
              target="_blank"
              rel="noreferrer"
              className="underline-offset-4 hover:underline"
            >
              Open-source licenses
            </a>
          </p>
        </div>
      </MogiScrollBody>
    </section>
  );
}

/**
 * The main path, in the order of a mogi. `wide` steps take two of three columns, so each row pairs a narrow card with a
 * wide one, alternating sides. `fit` scales a drawing made of the app's own components into its box (`IllustrationStage`).
 */
const steps: { number: number; title: string; art: ReactNode; fit?: number; wide?: boolean; text: ReactNode }[] = [
  {
    number: 1,
    title: "Start a mogi",
    art: <SetupArt />,
    fit: 0.7,
    text: (
      <>
        <Lead>Paste the bot&apos;s list.</Lead> Players, format and tier are read for you.
      </>
    ),
  },
  {
    number: 2,
    title: "Take a screenshot after each race",
    art: <ResultsScreenArt />,
    wide: true,
    text: (
      <>
        <Lead>End of each race, press Capture.</Lead> Missed one? The next screen works too.
      </>
    ),
  },
  {
    number: 3,
    title: "Send your screenshots to your device",
    art: <PhoneAlbumArt />,
    wide: true,
    text: (
      <>
        <Lead>Save them from the Nintendo Switch App.</Lead> In its album, save the screenshots to your photos. On a
        computer,{" "}
        <a
          href={NSO_ALBUM_SYNC}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-link underline-offset-4 hover:underline"
        >
          NSO Album Sync
        </a>{" "}
        brings the album over.
      </>
    ),
  },
  {
    number: 4,
    title: "Add them to the mogi",
    art: <RaceGridArt />,
    fit: 0.75,
    text: (
      <>
        <Lead>Drop in a batch.</Lead> The app sorts them into races. On a computer, drag them in or paste with{" "}
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>V</Kbd>
        </KbdGroup>{" "}
        /{" "}
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>V</Kbd>
        </KbdGroup>
        .
      </>
    ),
  },
  {
    number: 5,
    title: "Answer the occasional question",
    art: <QuestionArt />,
    fit: 0.7,
    text: (
      <>
        <Lead>It asks only when unsure.</Lead> Its best guess is already chosen; Not Sure leaves it for later.
      </>
    ),
  },
  {
    number: 6,
    title: "Submit",
    art: <SubmitArt />,
    fit: 0.5,
    wide: true,
    text: (
      <>
        <Lead>Copy !submit when the last race counts.</Lead> Paste it in Discord. Copy Table gives you the image any
        time.
      </>
    ),
  },
];

/** Each system's steps, in a sentence with its own control names. */
const installSystems: { platform: InstallPlatform; Icon: LucideIcon; title: string; steps: string }[] = [
  {
    platform: "ios",
    Icon: Smartphone,
    title: "iPhone and iPad",
    steps: "In any browser, tap Share, then Add to Home Screen and Add.",
  },
  {
    platform: "android",
    Icon: Smartphone,
    title: "Android",
    steps:
      "In Chrome, open the menu, then Add to Home screen and Install. Other browsers that install apps have it in their menu.",
  },
  {
    platform: "mac-safari",
    Icon: Laptop,
    title: "Mac with Safari",
    steps: "In Safari, choose File, then Add to Dock and Add.",
  },
  {
    platform: "desktop",
    Icon: Monitor,
    title: "Chrome or Edge on a computer",
    steps: "Click the install icon in the address bar, then Install.",
  },
];

/** A proof point, on the page with no card (the steps below are the cards): the claim, and the fact behind it. */
function Highlight({ Icon, proof, children }: { Icon: LucideIcon; proof: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-1">
      <Icon aria-hidden="true" className="mb-2 size-6 text-link" />
      <p className="font-semibold">{children}</p>
      <p className="text-sm text-muted-foreground">{proof}</p>
    </li>
  );
}

/** The first clause of a step, in bold so the page scans. */
function Lead({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

/**
 * A step of the main path, as a card. Every card hangs its number, title and text from the top-left corner and stands
 * its drawing in the bottom-right corner, as far from the right edge as the text is from the left, so the numbers of a
 * row share a line, and so do the drawings. A narrow card stacks the drawing under the text; a wide one, from three
 * columns, sets it beside.
 */
function Step({
  number,
  title,
  art,
  fit,
  wide,
  children,
}: {
  number: number;
  title: string;
  art: ReactNode;
  fit?: number;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex flex-col gap-6 rounded-3xl bg-muted p-6 [&_kbd]:bg-background",
        wide && "@[54rem]:col-span-2 @[54rem]:grid @[54rem]:grid-cols-2",
      )}
    >
      <div className="flex flex-col gap-1">
        <span aria-hidden="true" className="text-2xl/8 font-bold text-link tabular-nums">
          {number}
        </span>
        <h3 className="text-lg/6 font-semibold">
          <span className="sr-only">Step {number}: </span>
          {title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{children}</p>
      </div>
      <IllustrationStage fit={fit} className="ml-auto mt-auto">
        {art}
      </IllustrationStage>
    </li>
  );
}

/**
 * One more thing the app does, or a system's install steps: a symbol, a title and one description, spaced like a
 * section (`section-stack`), so each reads on its own. `action` sits under the description.
 */
function Feature({
  Icon,
  title,
  action,
  children,
}: {
  Icon: LucideIcon;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">{title}</h3>
        <p className="max-w-prose text-muted-foreground">{children}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </li>
  );
}

/** The finished mogi's header as the mogi screen draws it on compact: title, progress, who won and Copy !submit. */
function MogiHeaderArt() {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="whitespace-nowrap text-xl font-semibold">Mogi Tier D</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Finished
          <span className="block whitespace-nowrap font-medium text-foreground">Piloto 2 won by 12</span>
        </p>
      </div>
      <TileButton tone="primary" tabIndex={-1} className="@[35rem]:w-56">
        <SquareTerminal aria-hidden="true" />
        Copy !submit
      </TileButton>
    </div>
  );
}

const sampleList = "Tier D · 2v2\n1. Piloto 1, Piloto 2\n2. Piloto 3, Piloto 4";

/** The New Mogi sheet with the bot's list pasted, ready to create. */
function SetupArt() {
  return (
    <div className="flex w-full max-w-xs flex-col gap-2 rounded-2xl bg-background p-3 shadow-sm ring-1 ring-border">
      <p className="text-sm font-medium">Lounge bot list</p>
      <Textarea variant="filled" readOnly tabIndex={-1} rows={2} value={sampleList} className="min-h-0" />
      <GlassButton tint tabIndex={-1} className="w-full">
        Create
      </GlassButton>
    </div>
  );
}

/** Two counted races and Add Screenshots, as the mogi screen's floating bar shows it on compact. */
function RaceGridArt() {
  return (
    <div className="flex items-center gap-1.5">
      {[1, 2].map((race) => (
        <RaceTile key={race} state="counted" tabIndex={-1} className="w-14">
          {race}
        </RaceTile>
      ))}
      <GlassButton tint shape="circle" tabIndex={-1} className="ml-4">
        <ImagePlus aria-hidden="true" />
      </GlassButton>
    </div>
  );
}

/** A name question, its best guess already chosen. */
function QuestionArt() {
  return (
    <div className="flex w-full max-w-xs flex-col gap-2 rounded-2xl bg-background p-4 shadow-sm ring-1 ring-border">
      <p className="font-semibold">Who is “Pil0to 3”?</p>
      <ListRadioGroup
        aria-label="Players"
        value="p3"
        onValueChange={() => undefined}
        options={[
          { value: "p3", label: "Piloto 3", trail: "Suggested" },
          { value: "p8", label: "Piloto 8" },
        ]}
      />
      <GlassButton tint tabIndex={-1} className="w-full">
        Confirm
      </GlassButton>
    </div>
  );
}

/** The mogi's header once the last race counts, with Copy !submit as its action. */
function SubmitArt() {
  return (
    <div className="w-full max-w-md rounded-2xl bg-background p-4 shadow-sm ring-1 ring-border">
      <MogiHeaderArt />
    </div>
  );
}
