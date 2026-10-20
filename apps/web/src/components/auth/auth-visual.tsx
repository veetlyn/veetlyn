// The right half of the sign-in pages: the Payleor mark repeated as fine contour lines on a dark stage.
// Decorative only; everything a person needs is in the form beside it.
const MARK = "M10.5 25.5V7.5h7a5.75 5.75 0 0 1 0 11.5h-7";
const RINGS = Array.from({ length: 22 }, (_, i) => 0.5 + i * 0.075);

export default function AuthVisual() {
  return (
    <div aria-hidden="true" className="relative hidden overflow-hidden rounded-[18px] bg-stage text-stage-ink lg:block">
      <svg
        viewBox="0 0 32 32"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full [mask-image:radial-gradient(ellipse_at_60%_34%,black_18%,transparent_62%)]"
      >
        <g transform="translate(19 11.5)">
          {RINGS.map((scale, i) => (
            <path
              key={scale}
              d={MARK}
              transform={`scale(${scale}) translate(-14 -13)`}
              fill="none"
              stroke={i === 0 ? "var(--brand)" : "var(--stage-ink)"}
              strokeOpacity={i === 0 ? 1 : Math.max(0.06, 0.3 - i * 0.012)}
              strokeWidth={i === 0 ? 1.6 : 1}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      </svg>

      <div className="absolute inset-x-[10%] bottom-[9%]">
        <p className="max-w-md font-heading text-[2rem] leading-[1.1]">
          Quote it. Get paid.
          <br />
          Pay your team.
        </p>
        <p className="mt-3 max-w-sm text-sm text-stage-muted">
          Payleor keeps the money moving between your clients, your team and PayPal.
        </p>
      </div>
    </div>
  );
}
