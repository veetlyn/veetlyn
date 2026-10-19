import type { ReactElement } from "react";

import type { ArticleArtName } from "@/content/blog/posts";

// Article pictures from the brand's shapes: the bowl (square left, round right), mint as the signal, the band and
// paper. Every colour is a theme token, so they follow light and dark.
const ART = {
  gap: (
    <svg viewBox="0 0 800 450" aria-hidden="true" focusable="false">
      <rect width="800" height="450" fill="var(--tray)" />
      <rect x="60" y="90" width="260" height="170" rx="18" fill="var(--band)" />
      <rect x="90" y="130" width="170" height="12" rx="6" fill="var(--band-raise)" />
      <rect x="90" y="160" width="200" height="12" rx="6" fill="var(--band-raise)" />
      <rect x="90" y="190" width="120" height="12" rx="6" fill="var(--brand)" />
      <path d="M110 260 L100 300 L150 260Z" fill="var(--band)" />
      <path d="M330 175 H430" stroke="var(--brand)" strokeWidth="6" strokeLinecap="round" strokeDasharray="2 14" />
      <path d="M436 105H510.0A70 70 0 0 1 510 245H436A6 6 0 0 1 430 239V111A6 6 0 0 1 436 105Z" fill="var(--brand)" />
      <path d="M475 205V145h28a17 17 0 0 1 0 34h-28" fill="none" stroke="var(--brand-foreground)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M256 320H368.0A32 32 0 0 1 368 384H256A6 6 0 0 1 250 378V326A6 6 0 0 1 256 320Z" fill="var(--card)" />
      <path d="M436 320H518.0A32 32 0 0 1 518 384H436A6 6 0 0 1 430 378V326A6 6 0 0 1 436 320Z" fill="var(--foreground)" />
      <path d="M616 320H748.0A32 32 0 0 1 748 384H616A6 6 0 0 1 610 378V326A6 6 0 0 1 616 320Z" fill="var(--card)" />
      <rect x="270" y="346" width="90" height="12" rx="6" fill="var(--tray)" />
      <rect x="450" y="346" width="70" height="12" rx="6" fill="var(--band-raise)" />
      <rect x="630" y="346" width="110" height="12" rx="6" fill="var(--tray)" />
    </svg>
  ),
  freelancer: (
    <svg viewBox="0 0 800 450" aria-hidden="true" focusable="false">
      <rect width="800" height="450" fill="var(--band)" />
      <rect x="90" y="70" width="330" height="310" rx="18" fill="var(--card)" />
      <rect x="120" y="105" width="150" height="14" rx="7" fill="var(--foreground)" />
      <rect x="120" y="150" width="210" height="10" rx="5" fill="var(--tray)" />
      <rect x="360" y="150" width="36" height="10" rx="5" fill="var(--muted-foreground)" />
      <rect x="120" y="188" width="170" height="10" rx="5" fill="var(--tray)" />
      <rect x="360" y="188" width="36" height="10" rx="5" fill="var(--muted-foreground)" />
      <rect x="120" y="226" width="190" height="10" rx="5" fill="var(--tray)" />
      <rect x="360" y="226" width="36" height="10" rx="5" fill="var(--muted-foreground)" />
      <rect x="120" y="268" width="270" height="2" fill="var(--input)" />
      <rect x="120" y="292" width="90" height="14" rx="7" fill="var(--foreground)" />
      <rect x="330" y="292" width="66" height="14" rx="7" fill="var(--foreground)" />
      <path d="M126 330H243.0A17 17 0 0 1 243 364H126A6 6 0 0 1 120 358V336A6 6 0 0 1 126 330Z" fill="var(--brand)" />
      <path d="M486 150H682.0A28 28 0 0 1 682 206H486A6 6 0 0 1 480 200V156A6 6 0 0 1 486 150Z" fill="var(--brand)" />
      <path d="M486 222H682.0A28 28 0 0 1 682 278H486A6 6 0 0 1 480 272V228A6 6 0 0 1 486 222Z" fill="var(--band-raise)" />
      <circle cx="610" cy="345" r="42" fill="none" stroke="var(--brand)" strokeWidth="8" />
      <path d="M592 345l12 12 22-26" fill="none" stroke="var(--brand)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  agency: (
    <svg viewBox="0 0 800 450" aria-hidden="true" focusable="false">
      <rect width="800" height="450" fill="var(--tray)" />
      <path d="M76 165H220.0A60 60 0 0 1 220 285H76A6 6 0 0 1 70 279V171A6 6 0 0 1 76 165Z" fill="var(--band)" />
      <rect x="105" y="205" width="110" height="14" rx="7" fill="var(--band-raise)" />
      <rect x="105" y="235" width="70" height="14" rx="7" fill="var(--brand)" />
      <path d="M280 225 C 380 225, 400 92, 500 92" fill="none" stroke="var(--brand)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="530" cy="92" r="26" fill="var(--brand)" />
      <path d="M581 76H729.0A16 16 0 0 1 729 108H581A6 6 0 0 1 575 102V82A6 6 0 0 1 581 76Z" fill="var(--foreground)" />
      <path d="M280 225 C 380 225, 400 182, 500 182" fill="none" stroke="var(--input)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="530" cy="182" r="26" fill="var(--card)" />
      <path d="M581 166H679.0A16 16 0 0 1 679 198H581A6 6 0 0 1 575 192V172A6 6 0 0 1 581 166Z" fill="var(--card)" />
      <path d="M280 225 C 380 225, 400 272, 500 272" fill="none" stroke="var(--input)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="530" cy="272" r="26" fill="var(--card)" />
      <path d="M581 256H699.0A16 16 0 0 1 699 288H581A6 6 0 0 1 575 282V262A6 6 0 0 1 581 256Z" fill="var(--card)" />
      <path d="M280 225 C 380 225, 400 362, 500 362" fill="none" stroke="var(--input)" strokeWidth="4" strokeLinecap="round" />
      <circle cx="530" cy="362" r="26" fill="var(--card)" />
      <path d="M581 346H659.0A16 16 0 0 1 659 378H581A6 6 0 0 1 575 372V352A6 6 0 0 1 581 346Z" fill="var(--card)" />
    </svg>
  ),
  store: (
    <svg viewBox="0 0 800 450" aria-hidden="true" focusable="false">
      <rect width="800" height="450" fill="var(--band)" />
      <rect x="70" y="70" width="200" height="140" rx="18" fill="var(--card)" />
      <path d="M101 95H130.0A35 35 0 0 1 130 165H101A6 6 0 0 1 95 159V101A6 6 0 0 1 101 95Z" fill="var(--brand)" />
      <rect x="180" y="110" width="60" height="10" rx="5" fill="var(--tray)" />
      <rect x="180" y="140" width="40" height="10" rx="5" fill="var(--tray)" />
      <rect x="70" y="240" width="200" height="140" rx="18" fill="var(--card)" />
      <path d="M101 265H130.0A35 35 0 0 1 130 335H101A6 6 0 0 1 95 329V271A6 6 0 0 1 101 265Z" fill="var(--foreground)" />
      <rect x="180" y="280" width="60" height="10" rx="5" fill="var(--tray)" />
      <rect x="180" y="310" width="40" height="10" rx="5" fill="var(--tray)" />
      <path d="M270 140 C 340 140, 340 225, 400 225 M270 310 C 340 310, 340 225, 400 225" fill="none" stroke="var(--brand)" strokeWidth="6" strokeLinecap="round" />
      <path d="M410 170h40l30 110h150l26-80H470" fill="none" stroke="var(--card)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="505" cy="320" r="16" fill="var(--card)" />
      <circle cx="610" cy="320" r="16" fill="var(--card)" />
      <path d="M546 220H590.0A20 20 0 0 1 590 260H546A6 6 0 0 1 540 254V226A6 6 0 0 1 546 220Z" fill="var(--brand)" />
    </svg>
  ),
  studio: (
    <svg viewBox="0 0 800 450" aria-hidden="true" focusable="false">
      <rect width="800" height="450" fill="var(--tray)" />
      <rect x="120" y="75" width="280" height="300" rx="10" fill="var(--band)" />
      <path d="M400 75H530a150 150 0 0 1 0 300H400Z" fill="var(--brand)" />
      <circle cx="230" cy="180" r="34" fill="none" stroke="var(--card)" strokeWidth="8" />
      <circle cx="290" cy="180" r="34" fill="none" stroke="var(--card)" strokeWidth="8" />
      <path d="M230 214 L300 300 M290 214 L220 300" stroke="var(--card)" strokeWidth="8" strokeLinecap="round" />
      <rect x="485" y="150" width="90" height="170" rx="22" fill="var(--brand-foreground)" />
      <rect x="510" y="122" width="40" height="34" rx="8" fill="var(--brand-foreground)" />
      <rect x="500" y="210" width="60" height="12" rx="6" fill="var(--brand)" />
    </svg>
  ),
  visibility: (
    <svg viewBox="0 0 800 450" aria-hidden="true" focusable="false">
      <rect width="800" height="450" fill="var(--band)" />
      <rect x="70" y="70" width="380" height="300" rx="18" fill="var(--card)" />
      <circle cx="112" cy="112" r="16" fill="none" stroke="var(--muted-foreground)" strokeWidth="5" />
      <path d="M124 124l14 14" stroke="var(--muted-foreground)" strokeWidth="5" strokeLinecap="round" />
      <rect x="155" y="104" width="250" height="16" rx="8" fill="var(--tray)" />
      <rect x="100" y="160" width="260" height="14" rx="7" fill="var(--brand)" />
      <rect x="100" y="186" width="300" height="10" rx="5" fill="var(--tray)" />
      <rect x="100" y="204" width="200" height="10" rx="5" fill="var(--tray)" />
      <rect x="100" y="226" width="220" height="14" rx="7" fill="var(--foreground)" />
      <rect x="100" y="252" width="300" height="10" rx="5" fill="var(--tray)" />
      <rect x="100" y="270" width="200" height="10" rx="5" fill="var(--tray)" />
      <rect x="100" y="292" width="220" height="14" rx="7" fill="var(--foreground)" />
      <rect x="100" y="318" width="300" height="10" rx="5" fill="var(--tray)" />
      <rect x="100" y="336" width="200" height="10" rx="5" fill="var(--tray)" />
      <rect x="490" y="70" width="240" height="150" rx="18" fill="var(--band-raise)" />
      <rect x="515" y="105" width="170" height="12" rx="6" fill="var(--tray)" />
      <rect x="515" y="135" width="140" height="12" rx="6" fill="var(--tray)" />
      <path d="M521 165H649.0A16 16 0 0 1 649 197H521A6 6 0 0 1 515 191V171A6 6 0 0 1 521 165Z" fill="var(--brand)" />
      <rect x="500" y="330" width="30" height="50" rx="6" fill="var(--tray)" />
      <rect x="546" y="300" width="30" height="80" rx="6" fill="var(--tray)" />
      <rect x="592" y="310" width="30" height="70" rx="6" fill="var(--tray)" />
      <rect x="638" y="270" width="30" height="110" rx="6" fill="var(--tray)" />
      <rect x="684" y="240" width="30" height="140" rx="6" fill="var(--brand)" />
    </svg>
  ),
} satisfies Record<ArticleArtName, ReactElement>;

export default function ArticleArt({ name }: { name: ArticleArtName }) {
  return ART[name];
}
