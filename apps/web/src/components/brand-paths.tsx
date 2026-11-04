// The platform's mark, shared by the logo and the site's pictures. Two strokes meet in a rounded fold around the
// central dot; drawn on a 64-unit grid centred near (32, 31.5).

export const MARK_LEFT = "M4 6L22.78 50.86L23.88 50.4A8.8 8.8 0 0 1 31.94 38.2L31.93 37L18.96 6Z";
export const MARK_RIGHT = "M60 6L41.22 50.86L40.12 50.4A8.8 8.8 0 0 0 32.06 38.2L32.07 37L45.04 6Z";
export const MARK_FOLD =
  "M41.22 50.86A10 10 0 0 1 22.78 50.86L15.27 32.92A10 10 0 0 1 26 43A6 6 0 1 0 32 37A10 10 0 0 1 41.22 50.86Z";

// The full-colour mark: ink strokes and dots, the brand stroke and fold.
export function LogoPaths() {
  return (
    <>
      <path d={MARK_LEFT} fill="currentColor" />
      <circle cx="32" cy="47" r="10" fill="currentColor" />
      <path d={MARK_RIGHT} fill="var(--brand)" />
      <path d={MARK_FOLD} fill="var(--brand)" />
      <circle cx="32" cy="43" r="6" fill="currentColor" />
    </>
  );
}

// The mark in one colour, for a mint ground where the brand parts would vanish.
export function LogoPathsMono({ fill }: { fill: string }) {
  return (
    <g fill={fill}>
      <path d={MARK_LEFT} />
      <path d={MARK_RIGHT} />
      <circle cx="32" cy="47" r="10" />
    </g>
  );
}
