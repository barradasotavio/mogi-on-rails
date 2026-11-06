import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/vendor/shadcn/lib/utils";

/**
 * Where a picture sits on the Instructions page, with no panel of its own and one scale whatever the width; the box
 * hugs the drawing's ink, so placing the box places the drawing. An SVG drawing is 140px tall, its viewBox cropped to
 * its shapes. A drawing made of this app's components (`fit`) is laid out at `224 / fit` px and zoomed down to 224px
 * wide, as tall as it draws, against the box's right edge, where the page sets every drawing.
 * Hardware and game art use the fixed `art-*` tokens, so a TV stays dark in dark mode; only this app's own
 * components inside follow the theme.
 * Everything inside is decoration: hidden from assistive technology, because the text beside it says the same, and
 * inert, so a real component drawn here never takes focus or a tap.
 */
export function IllustrationStage({
  children,
  className,
  fit,
}: {
  children: ReactNode;
  className?: string;
  fit?: number;
}) {
  return (
    <div
      aria-hidden="true"
      inert
      className={cn("flex shrink-0 select-none items-center justify-center", fit ? "w-56" : "h-35", className)}
    >
      {fit ? (
        <div className="illustration-fit flex justify-end" style={{ "--fit": fit } as CSSProperties}>
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/** Twelve racers' colours: the team palette, twice, as on a results screen full of karts. */
const racers = ["fill-team-1", "fill-team-2", "fill-team-3", "fill-team-4", "fill-team-5", "fill-team-6"];
const racer = (index: number) => racers[index % racers.length];
/** Name lengths as a share of the row, so the rows read as players; no real names are drawn. */
const nameShares = [0.42, 0.5, 0.46, 0.54, 0.34, 0.38, 0.5, 0.26, 0.52, 0.36, 0.44, 0.32];
const points = [103, 52, 87, 94, 44, 85, 89, 97, 89, 96, 77, 71];
/** Gold, silver and bronze for the podium places; the rest are white on the game's dark rows. */
const podium = ["fill-team-3", "fill-team-1", "fill-team-6"];
/** The player's own row, lit up as the game does. */
const you = 7;

/**
 * The game's results screen, drawn to its proportions rather than copied: the race scene behind, and on the right
 * twelve translucent rows (place, character, name, points) from 3.7% to 89% of the height. `detail` draws the
 * places, characters and points; without it, a thumbnail keeps only the rows. Names are bars, never real names.
 */
function ResultsScreen({ x, y, width, detail = false }: { x: number; y: number; width: number; detail?: boolean }) {
  const height = (width * 9) / 16,
    left = x + width * 0.549,
    right = x + width * 0.956,
    row = height * 0.0667;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} className="fill-art-screen-ink" />
      <rect x={x} y={y} width={width} height={height} className="fill-team-1/45" />
      <path
        d={`M${x} ${y + height * 0.42}q${width * 0.2} ${-height * 0.12} ${width * 0.42} ${-height * 0.02}t${width * 0.58} ${-height * 0.04}V${y + height}H${x}z`}
        className="fill-team-4/35"
      />
      <path d={`M${x} ${y + height * 0.55}H${x + width}V${y + height}H${x}z`} className="fill-team-6/45" />
      <path
        d={`M${x} ${y + height * 0.78}L${x + width * 0.6} ${y + height * 0.6}H${x + width}V${y + height * 0.72}L${x + width * 0.2} ${y + height}H${x}z`}
        className="fill-art-screen-row/20"
      />
      {detail && (
        <g>
          <rect
            x={x + width * 0.2}
            y={y + height * 0.6}
            width={width * 0.12}
            height={height * 0.07}
            rx={height * 0.03}
            className="fill-team-2"
          />
          <circle cx={x + width * 0.25} cy={y + height * 0.57} r={width * 0.03} className="fill-team-5" />
          <circle cx={x + width * 0.215} cy={y + height * 0.68} r={width * 0.018} className="fill-art-device" />
          <circle cx={x + width * 0.305} cy={y + height * 0.68} r={width * 0.018} className="fill-art-device" />
        </g>
      )}
      {points.map((score, index) => {
        const top = y + height * (0.037 + index * 0.0713),
          middle = top + row / 2,
          lit = index === you;
        return (
          <g key={index}>
            <rect
              x={left}
              y={top}
              width={right - left}
              height={row}
              rx={row / 2}
              className={lit ? "fill-team-3" : "fill-art-screen-row/75"}
            />
            {detail && (
              <g>
                <text
                  x={x + width * 0.6}
                  y={middle + row * 0.32}
                  textAnchor="middle"
                  fontSize={row * 0.9}
                  fontStyle="italic"
                  fontWeight="800"
                  className={index < 3 && !lit ? podium[index] : lit ? "fill-art-screen-row" : "fill-art-screen-ink"}
                >
                  {index + 1}
                </text>
                <circle cx={x + width * 0.64} cy={middle} r={row * 0.42} className={racer(index)} />
                <circle
                  cx={x + width * 0.655}
                  cy={middle + row * 0.18}
                  r={row * 0.2}
                  className="fill-art-screen-ink/80"
                />
                <rect
                  x={x + width * 0.67}
                  y={middle - row * 0.15}
                  width={width * 0.2 * nameShares[index]}
                  height={row * 0.3}
                  rx={row * 0.15}
                  className={lit ? "fill-art-screen-row/70" : "fill-art-screen-ink/85"}
                />
                <text
                  x={x + width * 0.945}
                  y={middle + row * 0.3}
                  textAnchor="end"
                  fontSize={row * 0.8}
                  fontStyle="italic"
                  fontWeight="800"
                  className={lit ? "fill-art-screen-row" : "fill-art-screen-ink"}
                >
                  {score}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** A results screen after a race on a TV, drawn from the real screen's layout, with no Nintendo logos, characters or fonts. */
export function ResultsScreenArt() {
  return (
    <svg viewBox="16 4 248 159" className="h-full w-auto">
      <rect x="16" y="4" width="248" height="146.5" rx="10" className="fill-art-device" />
      <clipPath id="results-screen">
        <rect x="24" y="12" width="232" height="130.5" rx="4" />
      </clipPath>
      <g clipPath="url(#results-screen)">
        <ResultsScreen x={24} y={12} width={232} detail />
      </g>
      <rect x="130" y="150.5" width="20" height="8" className="fill-art-device-detail" />
      <rect x="110" y="158" width="60" height="5" rx="2.5" className="fill-art-device-detail" />
    </svg>
  );
}

/**
 * The Nintendo Switch App's album on a phone, evoked: a title over two columns of uploaded screenshots and the
 * floating tab bar at the bottom, the album tab current. The right column's first screenshot is chosen, so the
 * arrow to the photos leaves from the phone's edge without crossing the others.
 */
export function PhoneAlbumArt() {
  const thumbs = [0, 1, 2, 3, 4].map((index) => ({ x: 90.5 + (index % 2) * 31, y: 27 + Math.floor(index / 2) * 19 }));
  return (
    <svg viewBox="84 3 118 144" className="h-full w-auto">
      <rect x="84" y="3" width="72" height="144" rx="14" className="fill-art-device" />
      <rect x="88" y="7" width="64" height="136" rx="10" className="fill-art-screen" />
      <rect x="109" y="16" width="22" height="3.5" rx="1.75" className="fill-art-screen-ink/70" />
      <rect x="140" y="16" width="8" height="3.5" rx="1.75" className="fill-primary/70" />
      {thumbs.map((thumb, index) => (
        <g key={index}>
          <clipPath id={`album-${index}`}>
            <rect x={thumb.x} y={thumb.y} width="28" height="15.75" rx="1.5" />
          </clipPath>
          <g clipPath={`url(#album-${index})`}>
            <ResultsScreen x={thumb.x} y={thumb.y} width={28} />
          </g>
        </g>
      ))}
      <rect
        x={thumbs[1].x - 1}
        y={thumbs[1].y - 1}
        width="30"
        height="17.75"
        rx="2.5"
        className="fill-none stroke-primary"
        strokeWidth="1.5"
      />
      <circle cx={thumbs[1].x + 25} cy={thumbs[1].y + 3} r="3" className="fill-primary" />
      <rect x="96" y="87" width="48" height="2.5" rx="1.25" className="fill-art-screen-ink/30" />
      <rect x="101" y="92" width="38" height="2.5" rx="1.25" className="fill-art-screen-ink/30" />
      <rect x="94" y="122" width="52" height="13" rx="6.5" className="fill-art-screen-ink/15" />
      <path
        d="M100.5 132v-4.5l3.5-3 3.5 3v4.5z"
        className="fill-none stroke-team-2"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <rect x="116.5" y="124.5" width="7" height="7" rx="1.5" className="fill-none stroke-team-3" strokeWidth="1.3" />
      <rect x="132" y="125" width="9" height="6.5" rx="1" className="fill-team-1" />
      <rect x="113" y="139.5" width="14" height="1.5" rx=".75" className="fill-art-screen-ink/50" />
      <path
        d="M157 35q20 1 26 19"
        className="fill-none stroke-primary"
        strokeWidth="2"
        strokeDasharray="3 3"
        strokeLinecap="round"
      />
      <circle cx="186" cy="72" r="16" className="fill-primary" />
      <path
        d="M186 64.5v10m-4.5-4.5 4.5 4.5 4.5-4.5M181 79h10"
        className="fill-none stroke-primary-foreground"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
